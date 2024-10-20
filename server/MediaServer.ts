import express, { Request, Response, NextFunction } from 'express';
import { Server as SocketIOServer } from 'socket.io';
import http from 'http';
import Path from 'path';
import fs from 'fs-extra';
import Logger from './Logger';
import { fetchMediaFiles, slugify } from './helpers/utils';
import StreamSession from './StreamSession';
import FileInfo from './FileInfo';
import { EncodingOptions } from './EncodingOptions';

class MediaServer {
	private PORT: number | string;
	private MEDIA_PATH: string;
	private sessions: { [key: string]: StreamSession };
	private clients: { [key: string]: { id: string; socket: any; session?: string } };
	private io: SocketIOServer | undefined;

	constructor(port: number | string = process.env.PORT || 3000, mediaPath: string = process.env.MEDIA_PATH || './media') {
		this.PORT = port;
		this.MEDIA_PATH = mediaPath;
		this.sessions = {};
		this.clients = {};
		this.start();
	}

	private setHeaders(req: Request, res: Response, next: NextFunction): void {
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', '*');
		res.setHeader('Access-Control-Allow-Headers', '*');
		if (req.method === 'OPTIONS') {
			res.sendStatus(200);
		} else {
			next();
		}
	}

	private start(): void {
		const app = express();
		const server = http.createServer(app);
		this.io = new SocketIOServer(server, {
			cors: {
				origin: '*',
				methods: ['GET', 'POST'],
			},
		});

		app.use(this.setHeaders);
		app.use(express.static('public'));
		app.use(express.static(Path.join(__dirname, 'public')));

		app.get('/open', (req, res) => this.handleStreamRequest(req, res, false));
		app.get('/probe', this.handleProbeRequest.bind(this));
		app.get('/watch/:session', this.handleWatchRequest.bind(this));
		app.get('/:session/:file', this.handleFileRequest.bind(this));
		app.get('/sessions', (req, res) => {
			const sessions = Object.keys(this.sessions);
			res.json({ sessions });
		});
		app.get('/', this.handleClientIndex.bind(this));

		this.io.on('connection', (socket) => {
			Logger.info('New client connected:', socket.id);
			this.clients[socket.id] = { id: socket.id, socket };

			socket.on('disconnect', () => {
				Logger.info(`Client disconnected: ${socket.id}`);
				const sessionName = this.clients[socket.id]?.session;
				if (sessionName && this.sessions[sessionName]) {
					this.sessions[sessionName].close();
				}
				delete this.clients[socket.id];
			});
		});

		server.listen(this.PORT, () => Logger.info('[SERVER] Listening on port', this.PORT));
	}
	private async handleClientIndex(req: Request, res: Response): Promise<void> {
		const mediaPath = Path.resolve(this.MEDIA_PATH);
		await fs.ensureDir(mediaPath);
		const files = await fetchMediaFiles(mediaPath);
		res.json({ files });
	}

	private async handleProbeRequest(req: Request, res: Response): Promise<any> {
		const filename = req.query.file as string;
		const filepath = Path.resolve(this.MEDIA_PATH, filename);
		const exists = await fs.pathExists(filepath);
		if (!exists) {
			return res.sendStatus(404);
		}

		const fileInfo = new FileInfo(filepath);
		const successfullyProbed = await fileInfo.probe();
		if (!successfullyProbed) {
			Logger.error('Did not probe successfully');
			return res.sendStatus(500);
		}
		res.json(fileInfo.metadata);
	}

	private handleWatchRequest(req: Request, res: Response): void {
		const session = this.sessions[req.params.session];
		if (!session) res.sendStatus(404);
		res.send(session);
	}

	private handleStreamRequest(req: Request, res: Response, sendToPlayer: boolean): any {
		const filename = req.query.file as string;
		const socketId = req.query.socketId as string;
		if (!socketId || !this.clients[socketId]) {
			Logger.error('Invalid socket ID:', socketId);
			return res.sendStatus(400);
		}

		let sessionName = `${req.query.name ? (req.query.name as string) : slugify(Path.basename(filename, Path.extname(filename)))}-${socketId}-${Date.now()}`;
		this.openStream(socketId, res, sessionName, filename, sendToPlayer);
	}

	private async handleFileRequest(req: Request, res: Response): Promise<any> {
		const sessionId = req.params.session;
		const file = req.params.file;

		const hlsSession = this.sessions[sessionId];
		if (!hlsSession) {
			Logger.error('Invalid session', sessionId);
			return res.sendStatus(400);
		}

		const filePath = Path.join(hlsSession.streamPath, file);
		const fileExtname = Path.extname(file);
		const isPlaylist = fileExtname === '.m3u8';
		const isSegment = fileExtname === '.ts';

		if (!isPlaylist && !isSegment) {
			Logger.error('Invalid file', req.url);
			res.statusCode = 400;
			res.end();
		}

		let segmentNumber = 0;
		let segmentVariation = '0';

		if (isSegment) {
			var segmentResult = hlsSession.parseSegmentFilename(file);
			if (typeof segmentResult === 'boolean') {
				Logger.error('Invalid segment filename', file);
				return res.sendStatus(400);
			}

			const { number, variation } = segmentResult;

			segmentNumber = number;
			segmentVariation = variation;

			if (segmentVariation !== hlsSession.currentJobQuality) {
				Logger.clearProgress();
				const isRestarted = await hlsSession.restart(segmentNumber, segmentVariation);
				if (!isRestarted) {
					return res.sendStatus(500);
				}
				const segmentLoaded = await hlsSession.waitForSegment(segmentNumber, filePath);
				if (!segmentLoaded) {
					Logger.error(`Segment ${segmentNumber} still not loaded`);
					return res.sendStatus(404);
				}
			}

			const distanceFromCurrentSegment = segmentNumber - hlsSession.currentSegment;
			Logger.log('[REQUEST] Fetching segment', segmentNumber);
			if (distanceFromCurrentSegment === 10) {
				hlsSession.currentSegment++;
			}
		} else {
			Logger.log('[REQUEST] Fetching playlist', filePath);
		}

		const fileExists = hlsSession.getIsSegmentCreated(segmentNumber, segmentVariation) || (await fs.pathExists(filePath));
		if (!fileExists) {
			if (!isSegment) {
				Logger.error('[REQUEST] Playlist does not exist...', filePath);
				return res.sendStatus(400);
			}

			Logger.verbose('[REQUEST] Segment does not exist...', filePath);

			if (hlsSession.getShouldStartNewEncode(segmentNumber)) {
				const isRestarted = await hlsSession.restart(segmentNumber);
				if (!isRestarted) {
					return res.sendStatus(500);
				}
			}

			Logger.error(`Segment ${segmentNumber} still not loaded`);
			return res.sendStatus(404);
		}

		if (isSegment) {
			hlsSession.setSegmentFetched(segmentNumber, segmentVariation);
		}

		res.sendFile(filePath, (err) => {
			if (err) {
				Logger.error('Oops failed to send file', err);
			}
		});
	}

	private async openStream(socketId: string, res: Response, name: string, filename: string, sendToPlayer: boolean = false): Promise<any> {
		const filepath = Path.resolve(this.MEDIA_PATH, filename);
		Logger.info('Requested file path:', filepath);
		const exists = await fs.pathExists(filepath);

		if (!exists) {
			Logger.log('File not found', filepath);
			return res.sendStatus(404);
		}

		const fileInfo = new FileInfo(filepath);
		const successfullyProbed = await fileInfo.probe();
		if (!successfullyProbed) {
			Logger.error('Did not probe successfully');
			return res.sendStatus(500);
		}

		this.clients[socketId].session = name;

		const encodingOptions = new EncodingOptions(fileInfo);
		const streamSession = new StreamSession(name, fileInfo, encodingOptions);
		this.sessions[name] = streamSession;

		encodingOptions.numberOfSegments = await streamSession.generatePlaylist();
		streamSession.run();

		streamSession.on('close', () => {
			const sessionClients = Object.values(this.clients)
				.filter((client) => client.session === name)
				.map((c) => c.id);
			sessionClients.forEach((clientId) => {
				delete this.clients[clientId];
			});
			delete this.sessions[name];
		});

		res.json({ streamUrl: streamSession.url, fileInfo: streamSession.fileInfo });
	}
}

export default MediaServer;
