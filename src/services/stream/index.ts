import WebSocket from 'ws';
import { FastifyRequest } from 'fastify'; // Type only
import { config } from '../../config/env';
import { AudioUtils } from '../../utils/audio';
import { ConversationLogger } from '../logger';
import { ulawFromPCM, ulawToPCM } from 'g711';
import fs from 'fs';
import path from 'path';

// Interfaces for Gemini Messages
interface GeminiSetupMessage {
    setup: {
        model: string;
        generation_config?: {
            response_modalities: string[];
            speech_config?: {
                voice_config?: {
                    prebuilt_voice_config?: {
                        voice_name: string;
                    };
                };
            };
        };
        system_instruction?: {
            parts: { text: string }[];
        };
    };
}

interface GeminiClientContent {
    client_content: {
        turns: {
            role: string;
            parts: { text?: string; inline_data?: { mime_type: string; data: string } }[];
        }[];
        turn_complete: boolean;
    };
}

interface GeminiRealtimeInput {
    realtime_input: {
        media_chunks: {
            mime_type: string;
            data: string;
        }[];
    };
}

export class StreamBridgeService {
    private twilioWs: WebSocket;
    private geminiWs: WebSocket | null = null;
    private logger: ConversationLogger;
    private streamSid: string = '';
    private customerName: string;
    
    // State flags for synchronization
    private isGeminiConnected = false; // TCP connection open
    private isTwilioStarted = false;   // 'start' event received
    private isHandshakeComplete = false; // Setup message sent to Gemini

    constructor(twilioWs: WebSocket, request: any) { // using any for request to avoid complex type casting for now
        this.twilioWs = twilioWs;
        
        // Extract params from query string if passed (outbound), or default
        const query = request.query as any;
        this.customerName = query.customerName || config.call.customerName;

        // Initialize logger (phone number not known yet, will get from start message or use default)
        this.logger = new ConversationLogger(config.call.targetPhone); 
        
        this.setupTwilioHandlers();
        this.connectToGemini();
    }

    private setupTwilioHandlers() {
        this.twilioWs.on('message', (message: string) => {
            try {
                const data = JSON.parse(message);
                this.handleTwilioMessage(data);
            } catch (error) {
                console.error('Error parsing Twilio message:', error);
            }
        });

        this.twilioWs.on('close', () => {
            console.log('Twilio connection closed');
            this.close();
        });
    }

    private async connectToGemini() {
        const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${config.gemini.apiKey}`;
        
        this.geminiWs = new WebSocket(url);

        this.geminiWs.on('open', () => {
            console.log('Connected to Gemini');
            this.isGeminiConnected = true;
            this.attemptHandshake();
        });

        this.geminiWs.on('message', (data: Buffer) => {
            // console.log('Received message from Gemini:', data.toString()); // Uncomment for deep debugging
            this.handleGeminiMessage(data);
        });

        this.geminiWs.on('error', (err) => {
            console.error('Gemini WebSocket error:', err);
        });

        this.geminiWs.on('close', (code, reason) => {
            console.log(`Gemini connection closed. Code: ${code}, Reason: ${reason.toString()}`);
        });
    }

    // Attempts to send the setup message. 
    // Requires both Gemini connection AND Twilio 'start' event (to ensure we have the customer name).
    private attemptHandshake() {
        if (!this.isGeminiConnected || !this.isTwilioStarted || this.isHandshakeComplete) {
            return;
        }

        this.sendGeminiSetup();
    }

    private sendGeminiSetup() {
        if (!this.geminiWs) return;

        console.log(`Sending setup to Gemini for customer: ${this.customerName}`);

        // Load System Prompt
        const promptPath = path.join(process.cwd(), 'prompts', 'system.txt');
        let systemInstruction = "You are a helpful personal assistant.";
        
        try {
            const template = fs.readFileSync(promptPath, 'utf-8');
            systemInstruction = template.replace('{{customerName}}', this.customerName);
        } catch (err) {
            console.error('Error reading system prompt:', err);
        }

        const setupMessage: GeminiSetupMessage = {
            setup: {
                // Model selection via .env
                model: config.gemini.model,
                generation_config: {
                    response_modalities: ["AUDIO"],
                    speech_config: {
                        voice_config: {
                            prebuilt_voice_config: {
                                // Voice selection via .env (Zephyr, Puck, Charon, Fenrir, Kore, Aoede)
                                voice_name: config.gemini.voiceName 
                            }
                        }
                    }
                },
                system_instruction: {
                    parts: [{ text: systemInstruction }]
                }
            }
        };

        this.geminiWs.send(JSON.stringify(setupMessage));
        this.isHandshakeComplete = true;
    }

    private handleTwilioMessage(data: any) {
        switch (data.event) {
            case 'start':
                this.streamSid = data.start.streamSid;
                console.log(`Stream started: ${this.streamSid}`);
                
                // Extract custom parameters (passed via TwiML <Parameter>)
                if (data.start.customParameters && data.start.customParameters.customerName) {
                    this.customerName = data.start.customParameters.customerName;
                    console.log(`Identified customer from TwiML: ${this.customerName}`);
                }

                this.isTwilioStarted = true;
                this.attemptHandshake();
                break;
            
            case 'media':
                if (this.isHandshakeComplete && this.geminiWs && this.geminiWs.readyState === WebSocket.OPEN) {
                    this.processAudioFromTwilio(data.media.payload);
                }
                break;
            
            case 'stop':
                console.log('Stream stopped');
                this.close();
                break;
        }
    }

    private processAudioFromTwilio(payloadBase64: string) {
        // 1. Decode Base64 to Buffer
        const twilioBuffer = Buffer.from(payloadBase64, 'base64');
        
        // 2. Convert mu-law to PCM 16-bit (Linear)
        const pcmData = ulawToPCM(twilioBuffer); 
        
        // Convert the Int16Array returned by g711 to a proper NodeJS Buffer
        const pcmBuffer = Buffer.from(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength);

        // 3. Upsample 8kHz -> 24kHz
        const upsampledBuffer = AudioUtils.upsample8kTo16k(pcmBuffer);

        // 4. Send to Gemini
        const inputMessage: GeminiRealtimeInput = {
            realtime_input: {
                media_chunks: [{
                    mime_type: "audio/pcm;rate=24000",
                    data: upsampledBuffer.toString('base64')
                }]
            }
        };
        this.geminiWs?.send(JSON.stringify(inputMessage));
    }

    private handleGeminiMessage(data: Buffer) {
        try {
            const rawMessage = data.toString();
            const message = JSON.parse(rawMessage);
            
            // Log raw message if it's not just audio chunks
            if (!rawMessage.includes('data": "')) { 
                console.log('Gemini Message:', JSON.stringify(message, null, 2));
            }
            
            // Handle server content
            if (message.serverContent) {
                // HANDLE INTERRUPTION:
                if (message.serverContent.interrupted) {
                    console.log('⚠️ Interruption detected! Clearing Twilio buffer...');
                    this.sendTwilioClear();
                }

                const modelTurn = message.serverContent.modelTurn;
                if (modelTurn && modelTurn.parts) {
                    for (const part of modelTurn.parts) {
                        if (part.inlineData && part.inlineData.mimeType.startsWith('audio/pcm')) {
                            // Process Audio
                            const pcmBase64 = part.inlineData.data;
                            this.processAudioFromGemini(pcmBase64);
                        }
                        if (part.text) {
                             this.logger.log('GEMINI', part.text);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error parsing Gemini message:', error);
        }
    }

    private processAudioFromGemini(base64PCM: string) {
        // 1. Decode Base64
        const pcmBuffer = Buffer.from(base64PCM, 'base64');
        
        // 2. Downsample 24kHz -> 8kHz (Gemini output is usually 24k)
        const downsampledBuffer = AudioUtils.downsample24kTo8k(pcmBuffer);

        // 3. Convert PCM -> mu-law
        const int16View = new Int16Array(downsampledBuffer.buffer, downsampledBuffer.byteOffset, downsampledBuffer.length / 2);
        
        const mulawData = ulawFromPCM(int16View);
        const mulawBuffer = Buffer.from(mulawData);

        // 4. Send to Twilio
        const mediaMessage = {
            event: 'media',
            streamSid: this.streamSid,
            media: {
                payload: mulawBuffer.toString('base64')
            }
        };
        
        if (this.twilioWs.readyState === WebSocket.OPEN) {
            this.twilioWs.send(JSON.stringify(mediaMessage));
        }
    }

    private sendTwilioClear() {
        const clearMessage = {
            event: 'clear',
            streamSid: this.streamSid,
        };
        if (this.twilioWs.readyState === WebSocket.OPEN) {
            this.twilioWs.send(JSON.stringify(clearMessage));
        }
    }

    close() {
        this.logger.close();
        if (this.geminiWs) {
            this.geminiWs.close();
        }
    }
}
