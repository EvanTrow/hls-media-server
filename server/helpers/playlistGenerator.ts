import fs from 'fs-extra';
import Path from 'path';
import { EncodingOptions } from '../EncodingOptions';
import Logger from '../Logger';
import { FileInfo } from '../FileInfo';

async function generatePlaylist(inputFile: string, masterPlaylistPath: string, streamPath: string, encodingOptions: EncodingOptions): Promise<number> {
	try {
		const segmentLength = encodingOptions.segmentLength;
		const qualities = encodingOptions.qualityOptions;

		await fs.ensureDir(streamPath);
		const masterPlaylistStream = fs.createWriteStream(masterPlaylistPath);
		masterPlaylistStream.write('#EXTM3U\n');
		masterPlaylistStream.write('#EXT-X-VERSION:3\n');

		let numberOfSegments = 0;

		for (const quality of qualities) {
			const variantPlaylistPath = Path.join(streamPath, `${quality.name}.m3u8`);
			const variantPlaylistStream = fs.createWriteStream(variantPlaylistPath);

			variantPlaylistStream.write('#EXTM3U\n');
			variantPlaylistStream.write(`#EXT-X-TARGETDURATION:${segmentLength}\n`);
			variantPlaylistStream.write('#EXT-X-VERSION:3\n');
			variantPlaylistStream.write('#EXT-X-MEDIA-SEQUENCE:0\n');

			const duration = encodingOptions.duration;
			numberOfSegments = Math.ceil(duration / segmentLength);

			for (let i = 0; i < numberOfSegments; i++) {
				const segmentFile = `${quality.name}-${i + 1}.ts`;
				variantPlaylistStream.write(`#EXTINF:${segmentLength},\n`);
				variantPlaylistStream.write(`${segmentFile}\n`);
			}

			variantPlaylistStream.write('#EXT-X-ENDLIST\n');
			variantPlaylistStream.close();

			masterPlaylistStream.write(
				`#EXT-X-STREAM-INF:BANDWIDTH=${quality.videoBitrate},RESOLUTION=${encodingOptions.resolutionWidth}x${quality.resolution},CODECS="avc1.64001f,mp4a.40.2"\n${Path.basename(
					variantPlaylistPath
				)}\n`
			);
		}

		masterPlaylistStream.close();
		Logger.info('Playlist generation complete');
		return numberOfSegments;
	} catch (err) {
		Logger.error('Failed to generate playlist', err);
		throw err;
	}
}

export default generatePlaylist;
