import Ffmpeg from 'fluent-ffmpeg';
import { getResolutionText, getSreamDisplayTitle } from './metadataGrabbers';

interface StreamInfo {
	index: number;
	codec_type: string;
	codec_name?: string;
	codec_long_name?: string;
	codec_time_base?: string;
	time_base?: string;
	bit_rate?: number;
	language?: string;
	title?: string;
	disposition?: { [key: string]: number | string };
	profile?: string;
	is_avc?: boolean;
	pix_fmt?: string;
	avg_frame_rate?: string;
	r_frame_rate?: string;
	width?: number;
	height?: number;
	color_range?: string;
	color_space?: string;
	color_transfer?: string;
	color_primaries?: string;
	channels?: number;
	sample_rate?: string;
	channel_layout?: string;
	tags?: { [key: string]: string };
}

interface FormatInfo {
	format_long_name?: string;
	duration?: string;
	size?: string;
	bit_rate?: string;
	tags?: { [key: string]: string };
}

interface ProbeData {
	format: FormatInfo;
	streams: StreamInfo[];
}

function tryGrabBitRate(stream: StreamInfo, all_streams: StreamInfo[], total_bit_rate?: number): number | null {
	if (!isNaN(Number(stream.bit_rate)) && stream.bit_rate) {
		return Number(stream.bit_rate);
	}
	if (!stream.tags) {
		return null;
	}

	const bps = stream.tags.BPS || stream.tags['BPS-eng'] || stream.tags['BPS_eng'];
	if (bps && !isNaN(Number(bps))) {
		return Number(bps);
	}

	const tagDuration = stream.tags.DURATION || stream.tags['DURATION-eng'] || stream.tags['DURATION_eng'];
	const tagBytes = stream.tags.NUMBER_OF_BYTES || stream.tags['NUMBER_OF_BYTES-eng'] || stream.tags['NUMBER_OF_BYTES_eng'];
	if (tagDuration && tagBytes && !isNaN(Number(tagDuration)) && !isNaN(Number(tagBytes))) {
		const bps = Math.floor((Number(tagBytes) * 8) / Number(tagDuration));
		if (bps && !isNaN(bps)) {
			return bps;
		}
	}

	if (total_bit_rate && stream.codec_type === 'video') {
		let estimated_bit_rate = total_bit_rate;
		all_streams.forEach((stream) => {
			if (stream.bit_rate && !isNaN(Number(stream.bit_rate))) {
				estimated_bit_rate -= Number(stream.bit_rate);
			}
		});
		if (!all_streams.find((s) => s.codec_type === 'audio' && s.bit_rate && Number(s.bit_rate) > estimated_bit_rate)) {
			return estimated_bit_rate;
		} else {
			return total_bit_rate;
		}
	} else if (stream.codec_type === 'audio') {
		return 112000;
	} else {
		return 0;
	}
}

function tryGrabFrameRate(stream: StreamInfo): number | null {
	let avgFrameRateStrig = stream.avg_frame_rate || stream.r_frame_rate;

	let avgFrameRate: number | null = null;
	if (!avgFrameRateStrig) return null;
	const parts = avgFrameRateStrig.split('/');
	if (parts.length === 2) {
		avgFrameRate = Number(parts[0]) / Number(parts[1]);
	} else {
		avgFrameRate = Number(parts[0]);
	}
	if (!isNaN(avgFrameRate)) return avgFrameRate;
	return null;
}

function tryGrabSampleRate(stream: StreamInfo): number | null {
	const sample_rate = stream.sample_rate;
	if (!isNaN(Number(sample_rate))) return Number(sample_rate);
	return null;
}

function tryGrabChannelLayout(stream: StreamInfo): string | null {
	const layout = stream.channel_layout;
	if (!layout) return null;
	return String(layout).split('(').shift() || null;
}

function tryGrabTag(stream: StreamInfo, tag: string): string | null {
	if (!stream.tags) return null;
	return stream.tags[tag] || stream.tags[tag.toUpperCase()] || null;
}

function parseMediaStreamInfo(stream: StreamInfo, all_streams: StreamInfo[], total_bit_rate?: number) {
	const info = {
		index: stream.index,
		type: stream.codec_type,
		codec: stream.codec_name || null,
		codec_long: stream.codec_long_name || null,
		codec_time_base: stream.codec_time_base || null,
		time_base: stream.time_base || null,
		bit_rate: tryGrabBitRate(stream, all_streams, total_bit_rate),
		language: tryGrabTag(stream, 'language'),
		title: tryGrabTag(stream, 'title'),
		is_default: false,
		display_title: '',
	};

	if (info.type === 'audio' || info.type === 'subtitle') {
		const disposition = stream.disposition || {};

		info.is_default = disposition.default === 1 || disposition.default === '1';
	}

	if (info.type === 'video') {
		Object.assign(info, {
			profile: stream.profile || null,
			is_avc: stream.is_avc,
			pix_fmt: stream.pix_fmt || null,
			frame_rate: tryGrabFrameRate(stream),
			width: !isNaN(Number(stream.width)) ? Number(stream.width) : null,
			height: !isNaN(Number(stream.height)) ? Number(stream.height) : null,
			color_range: stream.color_range || null,
			color_space: stream.color_space || null,
			color_transfer: stream.color_transfer || null,
			color_primaries: stream.color_primaries || null,
			resolution: getResolutionText(stream),
		});
	} else if (stream.codec_type === 'audio') {
		Object.assign(info, {
			channels: stream.channels || null,
			sample_rate: tryGrabSampleRate(stream),
			channel_layout: tryGrabChannelLayout(stream),
		});
	}
	info['display_title'] = getSreamDisplayTitle(info);

	return info;
}

function parseProbeData(data: ProbeData) {
	try {
		const { format, streams } = data;
		const { format_long_name, duration, size, bit_rate } = format;

		const sizeBytes = !isNaN(Number(size)) ? Number(size) : null;
		const sizeMb = sizeBytes !== null ? Number((sizeBytes / (1024 * 1024)).toFixed(2)) : null;
		const cleanedData: any = {
			format: format_long_name,
			duration: !isNaN(Number(duration)) ? Number(duration) : null,
			size: sizeBytes,
			sizeMb,
			bit_rate: !isNaN(Number(bit_rate)) ? Number(bit_rate) : null,
			file_tag_encoder: tryGrabTag(format as any, 'encoder'),
			file_tag_title: tryGrabTag(format as any, 'title'),
			file_tag_creation_time: tryGrabTag(format as any, 'creation_time'),
		};

		const cleaned_streams = streams.map((s) => parseMediaStreamInfo(s, streams, cleanedData.bit_rate));
		cleanedData.video_stream = cleaned_streams.find((s) => s.type === 'video');
		cleanedData.audio_streams = cleaned_streams.filter((s) => s.type === 'audio');
		cleanedData.subtitle_streams = cleaned_streams.filter((s) => s.type === 'subtitle');

		if (cleanedData.audio_streams.length && cleanedData.video_stream) {
			const videoBitrate = cleanedData.video_stream.bit_rate;
			if (cleanedData.audio_streams.find((astream: any) => astream.bit_rate > videoBitrate)) {
				cleanedData.video_stream.bit_rate = cleanedData.bit_rate;
			}
		}

		return cleanedData;
	} catch (error) {
		console.error('Parse failed', error);
		return null;
	}
}

export function probe(filepath: string): Promise<any> {
	return new Promise((resolve) => {
		Ffmpeg.ffprobe(filepath, (err, raw) => {
			if (err) {
				console.error(err);
				resolve(null);
			} else {
				resolve(parseProbeData(raw as ProbeData));
			}
		});
	});
}

export default probe;
