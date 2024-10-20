// https://github.com/jellyfin/jellyfin/blob/e042651c54be1c379846ee77ef57c5f4d7a774de/MediaBrowser.Model/MediaInfo/AudioCodec.cs#L11
export function getAudioCodecFriendlyName(codec: string): string {
	if (!codec || !codec.length) return '';
	const codecLower = codec.toLowerCase();
	if (codecLower === 'ac3') return 'Dolby Digital';
	if (codecLower === 'eac3') return 'Dolby Digital+';
	if (codecLower === 'dca') return 'DTS';
	return codec.toUpperCase();
}

// https://github.com/jellyfin/jellyfin/blob/master/MediaBrowser.Model/Entities/MediaStream.cs#L117
export function getSreamDisplayTitle(i: any): string {
	const attributes: string[] = [];
	if (i.type === 'audio') {
		if (i.codec && i.codec.toLowerCase() !== 'dca') {
			const codecFriendlyName = getAudioCodecFriendlyName(i.codec);
			attributes.push(codecFriendlyName);
		}
		if (i.channel_layout) {
			attributes.push(i.channel_layout);
		} else if (i.channels) {
			attributes.push(`${i.channels}ch`);
		}

		if (i.title) {
			let _title = i.title;
			attributes.forEach((attr) => {
				if (!i.title.toLowerCase().includes(attr.toLowerCase())) {
					_title += ` - ${attr}`;
				}
			});
			return _title;
		}
		return attributes.join(' - ');
	} else if (i.type === 'video') {
		if (i.resolution) {
			attributes.push(i.resolution);
		}
		if (i.codec) {
			attributes.push(i.codec.toUpperCase());
		}
		if (i.title) {
			let _title = i.title;
			attributes.forEach((attr) => {
				if (!i.title.toLowerCase().includes(attr.toLowerCase())) {
					_title += ` - ${attr}`;
				}
			});
			return _title;
		}
		return attributes.join(' ');
	} else if (i.type === 'subtitle') {
		const is_default = i.is_default;
		const language = i.language || 'Unknown';
		if (is_default) return `${language} (Default)`;
		return language;
	} else {
		return '';
	}
}

// https://github.com/jellyfin/jellyfin/blob/master/MediaBrowser.Model/Entities/MediaStream.cs#L459
export function getResolutionText(i: { width?: number; height?: number }): string {
	const width = i.width || null;
	const height = i.height || null;
	if (width && height) {
		if (width >= 3800 || height >= 2000) {
			return '4K';
		}
		if (width >= 2500) {
			return '1440p';
		}
		if (width >= 1900 || height >= 1000) {
			return '1080p';
		}
		if (width >= 1260 || height >= 700) {
			return '720p';
		}
		if (width >= 700 || height >= 440) {
			return '480p';
		}
		return 'SD';
	}
	return '';
}
