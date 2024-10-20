import probeFile from './metadata/prober';
import { formatBytes } from './helpers/utils';

export interface VideoStream {
	resolution: string;
	index: number;
	height: number;
	width: number;
	codec: string;
	bit_rate: number;
	frame_rate: number;
}

export interface AudioStream {
	index: number;
	codec: string;
	bit_rate: number;
	channels: number;
	is_default: boolean;
}

export interface SubtitleStream {
	index: number;
	is_default: boolean;
}

export interface Metadata {
	duration: number;
	video_stream: VideoStream | null;
	audio_streams: AudioStream[];
	subtitle_streams: SubtitleStream[];
}

export class FileInfo {
	public filepath: string;
	public metadata: Metadata;

	constructor(filepath: string) {
		this.filepath = filepath;
		this.metadata = {
			duration: 0,
			video_stream: null,
			audio_streams: [],
			subtitle_streams: [],
		};
	}

	get duration(): number {
		return this.metadata.duration;
	}

	get durationPretty(): string {
		let seconds = this.duration;
		const minutes = Math.floor(seconds / 60);
		seconds = seconds - minutes * 60;
		const hours = Math.floor(minutes / 60);
		const remainingMinutes = minutes - hours * 60;
		seconds = Math.trunc(seconds);
		if (hours > 0) return `${hours}hr ${remainingMinutes}m ${seconds}s`;
		return `${remainingMinutes}m ${seconds}s`;
	}

	get videoDisplayTitle(): string {
		return this.videoStream ? this.videoStream.codec : 'Unknown';
	}

	get videoDisplaySize(): string {
		return this.videoStream ? `${this.videoWidth}x${this.videoHeight}` : 'Unknown';
	}

	get videoDisplayBitrate(): string {
		return this.videoBitrate ? formatBytes(this.videoBitrate) : 'N/A';
	}

	get videoDescription(): string {
		return `${this.videoDisplayTitle} [${this.videoDisplayBitrate}] (${this.videoDisplaySize})`;
	}

	get audioDisplayTitle(): string {
		return this.audioStream ? this.audioStream.codec : 'No Audio';
	}

	get audioDisplayBitrate(): string {
		return this.audioBitrate ? formatBytes(this.audioBitrate) : 'N/A';
	}

	get audioDescription(): string {
		return this.audioStream ? `${this.audioDisplayTitle} [${this.audioDisplayBitrate}]` : 'No Audio';
	}

	get videoStream(): VideoStream | null {
		return this.metadata.video_stream;
	}

	get videoStreamResolution(): string | null {
		return this.videoStream ? this.videoStream.resolution : null;
	}

	get videoStreamIndex(): number | null {
		return this.videoStream ? this.videoStream.index : null;
	}

	get videoHeight(): number | null {
		return this.videoStream ? this.videoStream.height : null;
	}

	get videoWidth(): number | null {
		return this.videoStream ? this.videoStream.width : null;
	}

	get audioStream(): AudioStream | null {
		return this.metadata.audio_streams.length ? this.metadata.audio_streams.find((stream) => stream.is_default) || this.metadata.audio_streams[0] : null;
	}

	get audioStreamIndex(): number | null {
		return this.audioStream ? this.audioStream.index : null;
	}

	get subtitleStream(): SubtitleStream | null {
		return this.metadata.subtitle_streams.length ? this.metadata.subtitle_streams.find((stream) => stream.is_default) || this.metadata.subtitle_streams[0] : null;
	}

	get videoCodec(): string | null {
		return this.videoStream ? this.videoStream.codec : null;
	}

	get videoBitrate(): number | null {
		return this.videoStream ? this.videoStream.bit_rate : null;
	}

	get frameRate(): number | null {
		return this.videoStream ? this.videoStream.frame_rate : null;
	}

	get audioCodec(): string | null {
		return this.audioStream ? this.audioStream.codec : null;
	}

	get audioBitrate(): number | null {
		return this.audioStream ? this.audioStream.bit_rate : null;
	}

	get audioChannels(): number | null {
		return this.audioStream ? this.audioStream.channels : null;
	}

	async probe(): Promise<boolean> {
		const metadata = await probeFile(this.filepath);
		if (!metadata) return false;
		this.metadata = metadata;
		return true;
	}
}

export default FileInfo;
