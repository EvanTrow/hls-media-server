import EventEmitter from 'events';
import fs from 'fs-extra';
import Path from 'path';
import chokidar, { FSWatcher } from 'chokidar';
import Ffmpeg from 'fluent-ffmpeg';
import Logger from './Logger';
import { EncodingOptions } from './EncodingOptions';
import FileInfo from './FileInfo';
import playlistGenerator from './helpers/playlistGenerator';
import progressbar from './helpers/progressbar';

class StreamSession extends EventEmitter {
	public name: string;
	public fileInfo: FileInfo;
	public encodingOptions: EncodingOptions;
	public outputPath: string;
	public streamPath: string;
	public masterPlaylistPath: string;
	public currentSegment: number;
	public currentJobQuality: string;
	public encodeStart: number;
	public encodeComplete: boolean;
	public segmentsCreated: { [key: string]: Set<number> };
	public segmentsFetched: { [key: string]: Set<number> };
	public watcher: FSWatcher | null;
	private ffmpeg: Ffmpeg.FfmpegCommand | null;
	private ffmpegLogLevel: string;
	private masterPlaylistName: string;
	private waitingForSegment: number | null;

	constructor(name: string, fileInfo: FileInfo, encodingOptions: EncodingOptions, outputPath: string = process.env.OUTPUT_PATH || './output') {
		super();

		this.name = name;
		this.fileInfo = fileInfo;
		this.encodingOptions = encodingOptions;
		this.outputPath = outputPath;
		this.streamPath = Path.resolve(outputPath, name);
		this.masterPlaylistName = 'master';
		this.masterPlaylistPath = Path.resolve(this.streamPath, this.masterPlaylistName + '.m3u8');
		this.ffmpegLogLevel = '-loglevel warning';
		this.ffmpeg = null;

		this.currentSegment = 0;
		this.currentJobQuality = '';
		this.encodeStart = 0;
		this.encodeComplete = false;
		this.waitingForSegment = null;

		this.segmentsCreated = {};
		this.segmentsFetched = {};
		this.watcher = null;
		this.initWatcher();

		process.on('SIGINT', async () => {
			Logger.log('[PROCESS] Signal interruption');
			await this.cleanupMess('SIGINT');
			Logger.log('[PROCESS] Exited gracefully');
			process.exit(0);
		});
	}

	get url(): string {
		return `/${this.name}/${this.masterPlaylistName}.m3u8`;
	}

	get fileDurationPretty(): string {
		return this.fileInfo ? this.fileInfo.durationPretty : 'Unknown';
	}

	get currentPlaylistPath(): string {
		const qualityName = this.encodingOptions.selectedQualityName;
		return Path.resolve(this.streamPath, qualityName + '.m3u8');
	}

	updateProgressBar(): void {
		const currentSegmentsCreated = this.segmentsCreated[this.currentJobQuality] || new Set();
		const currentSegmentsFetched = this.segmentsFetched[this.currentJobQuality] || new Set();
		const createdSegments = Array.from(currentSegmentsCreated.values());
		const fetchedSegments = Array.from(currentSegmentsFetched.values());
		progressbar(createdSegments, fetchedSegments, this.encodingOptions.numberOfSegments, this.currentSegment);
	}

	parseSegmentFilename(filepath: string): { variation: string; number: number } | false {
		const extname = Path.extname(filepath);
		if (extname !== '.ts') return false;
		const basename = Path.basename(filepath, extname);
		const portions = basename.split('-');
		const variationName = portions[0];
		const segmentNumber = Number(portions[1]);
		return {
			variation: variationName,
			number: segmentNumber,
		};
	}

	setSegmentFetched(number: number, variation: string): void {
		if (!this.segmentsFetched[variation]) this.segmentsFetched[variation] = new Set();
		this.segmentsFetched[variation].add(number);
		if (this.encodeComplete) {
			this.updateProgressBar();
		}
	}

	setSegmentCreated(number: number, variation: string): void {
		if (!this.segmentsCreated[variation]) this.segmentsCreated[variation] = new Set();
		this.segmentsCreated[variation].add(number);
	}

	getIsSegmentCreated(number: number, variation: string): boolean {
		if (!this.segmentsCreated[variation]) return false;
		return this.segmentsCreated[variation].has(number);
	}

	async initWatcher(): Promise<void> {
		await fs.ensureDir(this.streamPath);
		this.watcher = chokidar.watch(this.streamPath, {
			ignoreInitial: true,
			ignored: /(^|[\/\\])\../, // ignore dotfiles
			persistent: true,
			awaitWriteFinish: {
				stabilityThreshold: 500,
				pollInterval: 500,
			},
		});
		this.watcher
			.on('add', (path) => {
				this.onNewFile(path);
			})
			.on('error', (error) => {
				Logger.error(`[WATCHER] error: ${error}`);
			})
			.on('ready', () => {
				Logger.info(`[WATCHER] listening for segments at ${this.streamPath}`);
			});
	}

	onNewFile(path: string): void {
		if (path.endsWith('.m3u8')) {
			Logger.verbose('Playlist created');
			return;
		}
		const segmentDetails = this.parseSegmentFilename(path);
		if (segmentDetails === false) {
			Logger.log('Invalid segment written', path);
			return;
		}
		const { number, variation } = segmentDetails;

		this.setSegmentCreated(number, variation);
		this.updateProgressBar();
	}

	async waitForSegment(segmentNumber: number, filePath: string, attempts: number = 0): Promise<boolean> {
		if (attempts === 0) this.waitingForSegment = segmentNumber;
		if (attempts >= 10 || this.waitingForSegment !== segmentNumber) return false;

		await new Promise((resolve) => setTimeout(resolve, 1000));

		const exists = await fs.pathExists(filePath);
		if (!exists) {
			Logger.log(`[REQUEST] Wait for segment ${segmentNumber} attempt ${attempts} failed`);
			return this.waitForSegment(segmentNumber, filePath, ++attempts);
		} else {
			return true;
		}
	}

	getShouldStartNewEncode(segmentNumberRequested: number): boolean {
		const distanceFromCurrentSegment = segmentNumberRequested - this.currentSegment;
		if (distanceFromCurrentSegment > 10) {
			Logger.warn('Distance is too great... start new transcode');
			return true;
		} else if (distanceFromCurrentSegment < 0) {
			Logger.warn('This is in the past... start new transcode');
			return true;
		} else {
			return false;
		}
	}

	getTimestamp(seconds: number): string {
		const minutes = Math.floor(seconds / 60);
		const seconds_remaining = seconds - minutes * 60;
		const hours = Math.floor(minutes / 60);
		const remainingMinutes = minutes - 60 * hours;

		return `${String(hours).padStart(2, '0')}:${String(remainingMinutes).padStart(2, '0')}:${String(seconds_remaining).padStart(2, '0')}`;
	}

	async generatePlaylist(): Promise<number> {
		await fs.ensureDir(this.streamPath);
		return playlistGenerator(this.fileInfo.filepath, this.masterPlaylistPath, this.streamPath, this.encodingOptions);
	}

	async run(): Promise<void> {
		this.encodeStart = Date.now();
		this.encodeComplete = false;
		this.currentJobQuality = this.encodingOptions.selectedQualityName;

		if (Logger.isShowingProgressBar) {
			Logger.clearProgress();
		}

		Logger.session = this;

		this.ffmpeg = Ffmpeg();
		this.ffmpeg.addInput(this.fileInfo.filepath);
		if (this.encodingOptions.segmentStart > 0) {
			this.ffmpeg.inputOption(`-ss ${this.encodingOptions.startTime}`);
			this.ffmpeg.inputOption('-noaccurate_seek');
		}

		const segmentFilename = Path.join(this.streamPath, `${this.encodingOptions.selectedQualityName}-%d.ts`);
		this.ffmpeg
			.addOption(this.ffmpegLogLevel)
			.addOption(this.encodingOptions.transcodeOptions)
			.addOption(this.encodingOptions.hlsOptions)
			.addOption(`-hls_segment_filename ${segmentFilename}`)
			.output(this.currentPlaylistPath);

		this.ffmpeg.on('start', (command) => {
			Logger.log('[INFO] FFMPEG transcoding started with command: ' + command);
			this.updateProgressBar();
		});

		this.ffmpeg.on('stderr', (stdErrline) => {
			Logger.clearProgress();
			Logger.error(stdErrline);
		});

		this.ffmpeg.on('error', (err) => {
			if (err.message && err.message.includes('SIGKILL')) {
				// This is an intentional SIGKILL
				Logger.info('[FFMPEG] Transcode Killed');
			} else {
				Logger.clearProgress();
				Logger.error('Ffmpeg Err', err.message);
				this.cleanupMess('FfmpegErr');
			}
		});

		this.ffmpeg.on('end', () => {
			this.emit('end', this.name);
			this.encodeComplete = true;
			Logger.log('[FFMPEG] Transcoding ended');
		});

		this.ffmpeg.run();
	}

	deleteAllFiles(): Promise<boolean> {
		Logger.log('deleteAllFiles for', this.streamPath);
		return fs
			.remove(this.streamPath)
			.then(() => {
				Logger.log('Deleted session data', this.streamPath);
				return true;
			})
			.catch((err) => {
				Logger.error('Failed to delete session data', err);
				return false;
			});
	}

	close(): void {
		this.cleanupMess('close');
	}

	cleanupMess(caller: string = 'unknown'): Promise<boolean> {
		Logger.info('Cleaning up mess', caller);
		this.stop();
		return this.deleteAllFiles();
	}

	stop(): void {
		if (this.watcher) {
			this.watcher.removeAllListeners();
			this.watcher = null;
		}

		this.emit('close');

		if (!this.ffmpeg) return;

		Logger.log('Killing ffmpeg');
		this.ffmpeg.kill('SIGKILL');
	}

	async restart(segmentNumber: number, qualityVariation: string | null = null): Promise<boolean> {
		const timeSinceLastRestart = Date.now() - this.encodeStart;
		if (timeSinceLastRestart < 500) {
			Logger.error('Not restarting encode this quickly..');
			return false;
		}

		if (qualityVariation !== null) {
			this.encodingOptions.setSelectedQuality(qualityVariation);
		}

		this.ffmpeg && this.ffmpeg.kill('SIGKILL');
		this.waitingForSegment = null;

		const startTime = this.encodingOptions.getSegmentStartTime(segmentNumber);

		Logger.clearProgress();
		Logger.log('Restart encode @', startTime + 's', 'Segment:', segmentNumber);

		this.encodingOptions.segmentStart = segmentNumber;
		this.currentSegment = segmentNumber;

		// Todo: This should wait for previous ffmpeg job to finish
		await new Promise((resolve) => setTimeout(resolve, 100));

		this.run();
		return true;
	}
}

export default StreamSession;
