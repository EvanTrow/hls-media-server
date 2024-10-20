import Logger from './Logger';
import { formatBytes } from './helpers/utils';
import FileInfo from './FileInfo';

interface QualityOption {
	name: string;
	resolution: number;
	videoBitrate: number;
	audioBitrate: number;
	isDirectStream?: boolean;
}

export class EncodingOptions {
	public segmentLength: number;
	public segmentStart: number;
	public segmentTimestamps: number[];
	public hardcodeSubtitles: boolean;
	public numberOfSegments: number;
	public fileInfo: FileInfo;
	public qualityOptions: QualityOption[];
	public selectedQualityIndex: number;

	constructor(fileInfo: FileInfo, maxNetworkBitrate: number = 7200000) {
		this.segmentLength = 3;
		this.segmentStart = 0;
		this.segmentTimestamps = [];
		this.hardcodeSubtitles = false;
		this.numberOfSegments = 0;
		this.fileInfo = fileInfo;

		// Set Quality Options
		this.qualityOptions = QualityOptions.filter((opt) => maxNetworkBitrate >= opt.videoBitrate && (fileInfo?.videoBitrate ?? 0) >= opt.videoBitrate);
		this.selectedQualityIndex = this.qualityOptions.length - 1;

		if (this.canDirectStreamVideo) {
			const dsOption: QualityOption = {
				name: `${this.fileInfo.videoStreamResolution}_direct`,
				resolution: this.fileInfo?.videoHeight ?? 0,
				videoBitrate: this.fileInfo?.videoBitrate ?? 0,
				audioBitrate: this.fileInfo?.audioBitrate ?? 0,
				isDirectStream: true,
			};
			let indexToInsert = this.qualityOptions.findIndex((opt) => opt.videoBitrate < dsOption.videoBitrate);
			if (indexToInsert < 0) {
				indexToInsert = this.qualityOptions.length;
				this.qualityOptions.push(dsOption);
			} else {
				this.qualityOptions.splice(indexToInsert, 0, dsOption);
			}
			this.selectedQualityIndex = indexToInsert;
		}

		if (!this.qualityOptions.length) {
			Logger.error('No Quality Options', fileInfo.videoBitrate);
			this.selectedQualityIndex = 0;
			this.qualityOptions = [QualityOptions[0]];
		}
	}

	get resolutionWidth(): number {
		return this.resolutionHeight * (3 / 2);
	}

	get resolutionHeight(): number {
		return this.selectedQuality.resolution;
	}

	get videoBitrate(): number {
		return this.selectedQuality.videoBitrate;
	}

	get audioBitrate(): number {
		return this.selectedQuality.audioBitrate;
	}

	get selectedQuality(): QualityOption {
		return this.qualityOptions[this.selectedQualityIndex];
	}

	get selectedQualityName(): string {
		if (!this.selectedQuality) {
			Logger.error('No Quality Selected');
			return 'ERROR';
		}
		return this.selectedQuality.name;
	}

	get startTime(): number {
		return this.getSegmentStartTime(this.segmentStart);
	}

	get actualSegmentLengthString(): string {
		const segmentLengthAdjustment = this.frameRateNTSC ? this.segmentLength : 0;
		return `${this.segmentLength}.00${segmentLengthAdjustment}000`;
	}

	get actualSegmentLength(): number {
		return Number(this.actualSegmentLengthString);
	}

	get videoDisplaySize(): string {
		return `${this.encodeSize.width}x${this.encodeSize.height}`;
	}

	get videoDisplayBitrate(): string {
		return formatBytes(this.videoBitrate);
	}

	get encodeVideoDisplay(): string {
		return `${this.videoEncoder} [${this.videoDisplayBitrate}] (${this.videoDisplaySize})`;
	}

	get audioDisplayBitrate(): string {
		return formatBytes(this.audioBitrate);
	}

	get encodeAudioDisplay(): string {
		return this.fileInfo.audioStream ? `${this.audioEncoder} ${this.audioChannels}ch [${this.audioDisplayBitrate}]` : 'No Audio';
	}

	get duration(): number {
		return this.fileInfo.duration;
	}

	get encodeSize(): { width: number; height: number } {
		const videoAspectRatio = this.fileInfo.videoHeight && this.fileInfo.videoWidth ? this.fileInfo.videoWidth / this.fileInfo.videoHeight : null;
		const width = this.resolutionWidth;
		const height = videoAspectRatio ? Math.trunc(width / videoAspectRatio) : this.resolutionHeight;
		return {
			width,
			height,
		};
	}

	get encodeFrameRate(): number {
		return this.fileInfo.frameRate || 24;
	}

	get frameRateNTSC(): boolean {
		return this.encodeFrameRate % 1 !== 0;
	}

	get audioEncoder(): string {
		return 'aac';
	}

	get audioChannels(): number {
		return this.fileInfo?.audioChannels ?? 0;
	}

	get videoEncoder(): string {
		return 'libx264';
	}

	get canDirectStreamVideo(): boolean {
		return this.fileInfo.videoCodec === 'h264';
	}

	get canDirectStreamAudio(): boolean {
		const codecsSupported = ['aac'];
		return codecsSupported.includes(this.fileInfo?.audioCodec ?? '');
	}

	get videoTranscodeOptions(): string[] {
		if (this.canDirectStreamVideo && this.selectedQuality.isDirectStream) {
			return ['-c:v copy'];
		}
		let scaler = '';
		if (this.fileInfo.subtitleStream && this.hardcodeSubtitles) {
			scaler = `-filter_complex [0:2]scale=${this.encodeSize.width}x${this.encodeSize.height}[sub];[0:0]scale='trunc(min(max(iw,ih*dar),${this.encodeSize.width})/2)*2':'trunc(ow/dar/2)*2'[base];[base][sub]overlay`;
		} else {
			scaler = `-vf scale='trunc(min(max(iw,ih*dar),${this.encodeSize.width})/2)*2':'trunc(ow/dar/2)*2'`;
		}
		return [
			`-codec:v:0 ${this.videoEncoder}`,
			'-pix_fmt yuv420p',
			'-preset veryfast',
			'-crf 23',
			`-maxrate ${this.videoBitrate}`,
			`-bufsize ${this.videoBitrate * 2}`,
			'-profile:v:0 high',
			'-level 41',
			scaler,
		];
	}

	get transcodeOptions(): string[] {
		const maps = [`-map 0:${this.fileInfo.videoStreamIndex}`];
		if (this.fileInfo.audioStream) {
			maps.push(`-map 0:${this.fileInfo.audioStreamIndex}`);
		}
		if (!this.fileInfo.subtitleStream || !this.hardcodeSubtitles) {
			maps.push('-map -0:s'); // Do not include subtitle stream
		}
		const frameRate = this.encodeFrameRate;
		const gopSize = frameRate * this.segmentLength;
		const options = [
			'-threads 0',
			'-map_metadata -1',
			'-map_chapters -1',
			...maps,
			`-r ${frameRate}`,
			'-sc_threshold 0', // Disable scene detection cuts. Could be a bad move.
			...this.videoTranscodeOptions,
			'-start_at_zero',
			'-vsync -1',
			`-g ${gopSize}`,
		];
		if (this.fileInfo.audioStream) {
			if (this.canDirectStreamAudio && this.selectedQuality.isDirectStream) {
				options.push(`-c:a copy`);
			} else {
				options.push(`-codec:a:0 ${this.audioEncoder}`); // Todo: select correct audio index here
				options.push(`-ac ${this.audioChannels}`);
				options.push(`-ab ${this.audioBitrate}`);
			}
		}
		return options;
	}

	get hlsOptions(): string[] {
		return [
			'-f hls',
			'-copyts',
			'-avoid_negative_ts disabled',
			'-max_delay 5000000',
			'-max_muxing_queue_size 2048',
			`-hls_time ${this.segmentLength}`,
			'-hls_segment_type mpegts',
			`-start_number ${this.segmentStart}`,
			'-hls_playlist_type vod',
			'-hls_list_size 0',
			'-hls_allow_cache 0',
		];
	}

	getSegmentStartTime(segmentNumber: number): number {
		let time = 0;
		for (let i = 0; i < segmentNumber; i++) {
			if (this.segmentTimestamps.length > i) {
				time += this.segmentTimestamps[i];
			}
		}
		return time;
	}

	setSelectedQuality(name: string): boolean {
		const qualityIndex = this.qualityOptions.findIndex((qopt) => qopt.name === name);
		if (qualityIndex < 0) {
			Logger.error('Quality not found', name);
			return false;
		}
		this.selectedQualityIndex = qualityIndex;
		return true;
	}
}

const QualityOptions: QualityOption[] = [
	{ name: '360p', resolution: 360, videoBitrate: 1200000, audioBitrate: 112000 },
	{ name: '480p', resolution: 480, videoBitrate: 2400000, audioBitrate: 128000 },
	{ name: '720p', resolution: 720, videoBitrate: 4000000, audioBitrate: 160000 },
	{ name: '1080p', resolution: 1080, videoBitrate: 7200000, audioBitrate: 224000 },
];
