import { TwilioService } from './services/twilio';
import { config } from './config/env';

async function main() {
    if (!config.call.targetPhone) {
        console.error('Error: TARGET_PHONE not set in .env');
        process.exit(1);
    }

    console.log('Starting call process...');
    try {
        await TwilioService.initiateCall(
            config.call.targetPhone,
            config.call.customerName
        );
        console.log('Call initiation command sent successfully.');
    } catch (error) {
        console.error('Failed to initiate call:', error);
        process.exit(1);
    }
}

main();

