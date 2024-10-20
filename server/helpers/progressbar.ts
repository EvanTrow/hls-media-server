import chalk from 'chalk';
import Logger from '../Logger';

const CHARACTERS = ['░', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];

function getCharacterForPercentage(percentage: number): string {
	const charIndex = Math.floor(percentage * (CHARACTERS.length - 1));
	if (!CHARACTERS[charIndex]) {
		console.error('Invalid character index', charIndex, percentage);
		return 'X';
	}
	return CHARACTERS[charIndex];
}

export default function build(segmentsCreated: number[], segmentsFetched: number[], totalSegments: number, currentSegment: number): void {
	const segments: number[] = new Array(totalSegments).fill(0);

	segmentsCreated.forEach((seg) => (segments[seg] = 1));
	segmentsFetched.forEach((seg) => (segments[seg] = 2));

	const percentageComplete = ((segmentsCreated.length / totalSegments) * 100).toFixed(2);
	const percentageFetched = ((segmentsFetched.length / totalSegments) * 100).toFixed(2);

	let numberOfChunks = 100;
	if (totalSegments < numberOfChunks) numberOfChunks = totalSegments;

	const segmentsPerChar = Math.floor(totalSegments / numberOfChunks);

	let progbar = '';
	let currbar = '';
	for (let i = 0; i < numberOfChunks; i++) {
		const chunkStart = i * segmentsPerChar;
		const chunkEnd = i === numberOfChunks - 1 ? totalSegments : chunkStart + segmentsPerChar;

		const isCurrentSegmentInChunk = currentSegment >= chunkStart && currentSegment < chunkEnd;
		currbar += isCurrentSegmentInChunk ? chalk.green('▼') : ' ';

		const chunk = segments.slice(chunkStart, chunkEnd);

		const chunkSum = chunk.reduce((sum, seg) => sum + (seg > 0 ? 1 : 0), 0);
		const segsInChunkFetched = chunk.filter((seg) => seg === 2).length;

		let chunkColor: keyof typeof chalk = 'gray';
		let bgColor: keyof typeof chalk = 'bgBlack';

		if (chunkSum > 0) {
			chunkColor = 'white';
			bgColor = 'bgGray';
		}

		if (segsInChunkFetched === chunk.length) {
			chunkColor = 'green';
		}

		const perc = chunkSum / chunk.length;
		const char = getCharacterForPercentage(perc);
		progbar += chalk[chunkColor][bgColor](char);
	}

	const progressLines: string[] = [];

	const chunkstr = chalk.gray(`Number of Chunks: ${numberOfChunks}, Segs per Chunk: ${segmentsPerChar}`);
	if (Logger.logLevel === 'verbose') progressLines.push(chunkstr);

	const totalSegStr = chalk.inverse(` Total Segments: ${totalSegments} `);
	const currSegStr = chalk.inverse(` Current Segment: ${currentSegment} `);
	const percCompleteStr = chalk.inverse(` ${percentageComplete}% Created `);
	const percFetchedStr = chalk.inverse(` ${percentageFetched}% Fetched `);

	const summaryStr = [totalSegStr, currSegStr, percCompleteStr, percFetchedStr].join(' ◈ ');
	progressLines.push(summaryStr);
	progressLines.push(currbar);
	progressLines.push(progbar);

	Logger.updateProgress(...progressLines);
}
