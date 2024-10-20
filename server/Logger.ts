// import logUpdate from 'log-update';

const BOX_WIDTH = 104;

type LogLevel = 'verbose' | 'debug' | 'info' | 'warn' | 'error';

class Logger {
	public logLevel: LogLevel | undefined;
	public progressLines: string[];
	public currentLog: string;
	public session: any;
	public isShowingProgressBar: boolean;

	constructor() {
		this.logLevel = process.env.LOG_LEVEL as LogLevel;
		this.progressLines = [];
		this.currentLog = '';
		this.session = null;
		this.isShowingProgressBar = false;
	}

	private get progressSessionName(): string | null {
		return this.session ? this.session.name : null;
	}

	private get progressSessionDuration(): string | null {
		return this.session ? this.session.fileDurationPretty : null;
	}

	private getBoxTopBottom(bottom: boolean = false): string {
		let str = bottom ? '╚' : '╔';
		for (let i = 0; i < BOX_WIDTH - 2; i++) str += '═';
		return str + (bottom ? '╝' : '╗');
	}

	private getBoxDivider(double: boolean = false): string {
		let str = double ? '╠' : '╟';
		for (let i = 0; i < BOX_WIDTH - 2; i++) str += double ? '═' : '┄';
		return str + (double ? '╣' : '╢');
	}

	private getActualLength(str: string): number {
		if (!str) return 0;
		return str.replace(/\u001b\u009b\[\(\)\#\;\?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '').length;
	}

	private padEnd(line: string, padchar: string = ' '): string {
		const linelen = this.getActualLength(line);
		const numPadding = BOX_WIDTH - 4 - linelen;
		let padstr = '';
		for (let i = 0; i < numPadding; i++) padstr += padchar;
		return line + padstr;
	}

	private padCenter(line: string, padchar: string = ' '): string {
		const linelen = this.getActualLength(line);
		let numPadding = (BOX_WIDTH - 4 - linelen) / 2;
		numPadding = Math.floor(numPadding);

		let padstr = '';
		for (let i = 0; i < numPadding; i++) padstr += padchar;
		return padstr + line + padstr;
	}

	private printProgress(): void {
		const top = this.getBoxTopBottom(false);
		const bottom = this.getBoxTopBottom(true);

		const titleLine = `${this.progressSessionName} (${this.progressSessionDuration})`;
		const sessionNameLine = this.padCenter(titleLine);

		let log = this.currentLog;
		const loglen = this.getActualLength(this.currentLog);
		if (loglen > BOX_WIDTH - 4) log = this.currentLog.slice(0, BOX_WIDTH - 8) + '...';
		const lines = [sessionNameLine, '=', log, '-', ...this.progressLines];

		let logstr = top + '\n';
		lines.forEach((line) => {
			if (line === '-' || line === '=') {
				logstr += this.getBoxDivider(line === '=') + '\n';
			} else {
				logstr += '║ ' + this.padEnd(line) + ' ║\n';
			}
		});
		logstr += bottom;

		// logUpdate(logstr);
	}

	public clearProgress = (): void => {
		this.isShowingProgressBar = false;
		// logUpdate.clear();
		console.log('>>>');
	};

	public updateProgress = (...lines: string[]): void => {
		this.isShowingProgressBar = true;
		this.progressLines = lines;
		this.printProgress();
	};

	public verbose = (...msg: any[]): void => {
		if (this.logLevel !== 'verbose') return;
		if (this.isShowingProgressBar) {
			this.currentLog = msg.join(' ');
			return this.printProgress();
		}
		console.log(...msg);
	};

	public log = (...msg: any[]): void => {
		if (this.logLevel !== 'debug') return;
		if (this.isShowingProgressBar) {
			this.currentLog = msg.join(' ');
			return this.printProgress();
		}
		console.log(...msg);
	};

	public info = (...msg: any[]): void => {
		if (this.isShowingProgressBar) {
			this.currentLog = msg.join(' ');
			return this.printProgress();
		}
		console.log(...msg);
	};

	public warn = (...msg: any[]): void => {
		if (this.isShowingProgressBar) {
			this.currentLog = msg.join(' ');
			return this.printProgress();
		}
		console.warn(...msg);
	};

	public error = (...msg: any[]): void => {
		if (this.isShowingProgressBar) {
			this.currentLog = msg.join(' ');
			return this.printProgress();
		}
		console.error(...msg);
	};
}

export default new Logger();
