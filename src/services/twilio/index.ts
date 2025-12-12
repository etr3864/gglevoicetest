import twilio from 'twilio';
import { config } from '../../config/env';

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

export class TwilioService {
    static async initiateCall(to: string, customerName: string) {
        try {
            const streamUrl = `${config.server.ngrokUrl.replace('https://', 'wss://')}/media-stream`;
            
            // Construct TwiML
            const response = new twilio.twiml.VoiceResponse();
            const connect = response.connect();
            const stream = connect.stream({
                url: streamUrl,
            });
            // Pass parameters as query params in the stream URL inside TwiML is tricky, 
            // Twilio Stream <Parameter> tag is better.
            stream.parameter({
                name: 'customerName',
                value: customerName
            });

            console.log(`Initiating call to ${to}...`);
            const call = await client.calls.create({
                to,
                from: config.twilio.phoneNumber,
                twiml: response.toString(),
            });

            console.log(`Call initiated: ${call.sid}`);
            return call.sid;
        } catch (error) {
            console.error('Error initiating Twilio call:', error);
            throw error;
        }
    }
}

