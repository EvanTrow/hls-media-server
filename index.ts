import MediaServer from './server/MediaServer';

// get config path
require('dotenv').config();

async function start() {
	if (!process.env.PORT || !process.env.MEDIA_PATH) {
		console.log('Missing .env file. Create a .env file and include PORT, MEDIA_PATH, OUTPUT_PATH, and LOG_LEVEL.');
		return;
	}

	new MediaServer();
}

start();
