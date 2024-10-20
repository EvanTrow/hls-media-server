import Path from 'path';
import fs from 'fs-extra';

export function formatBytes(bytes: number, decimals: number = 2): string {
	if (isNaN(bytes) || bytes === null) return 'N/A';
	if (bytes === 0) {
		return '0 Bytes';
	}
	const k = 1024;
	const dm = decimals < 0 ? 0 : decimals;
	const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

async function fetchAllFilesInDir(dir: string): Promise<string[]> {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	const files = entries.filter((file) => !file.isDirectory()).map((file) => Path.join(dir, file.name));
	const folders = entries.filter((folder) => folder.isDirectory());
	for (const folder of folders) {
		files.push(...(await fetchAllFilesInDir(Path.join(dir, folder.name))));
	}
	return files;
}

export async function fetchMediaFiles(dir: string): Promise<(string | undefined)[]> {
	const VIDEO_FORMATS = ['.avi', '.mp4', '.mkv', '.m4v', '.m2ts'];
	const files = await fetchAllFilesInDir(dir);

	return files
		.filter((filepath) => {
			return VIDEO_FORMATS.includes(Path.extname(filepath));
		})
		.map((filepath) => {
			let _filepath = filepath.replace(dir, '');
			if (_filepath.startsWith(`\\`) || _filepath.startsWith('/')) return _filepath.substr(1);
			return _filepath;
		});
}

export function slugify(text: string): string {
	if (!text) return 'Error';
	return text
		.toString()
		.toLowerCase()
		.trim()
		.replace(/[\/\\]/g, '.') // replace slashes with .
		.replace(/[^\w\s-.]/g, '') // remove non-word [a-z0-9_], non-whitespace, non-hyphen characters, non-period
		.replace(/[\s_-]+/g, '_') // swap any length of whitespace, underscore, hyphen characters with a single _
		.replace(/^-+|-+$/g, ''); // remove leading, trailing -
}
