export class AudioUtils {
    // Upsample from 8000Hz to 24000Hz (Input to Gemini 2.5)
    // Interpolation: repeat each 16-bit sample 3 times
    static upsample8kTo16k(buffer: Buffer): Buffer { // Keeping name for compatibility, but logic is 8k->24k
        // Output size is 3 times the input size
        const newBuffer = Buffer.alloc(buffer.length * 3);
        
        // Iterate over 16-bit samples (2 bytes)
        for (let i = 0; i < buffer.length; i += 2) {
            if (i + 1 >= buffer.length) break;

            const sampleLow = buffer[i];
            const sampleHigh = buffer[i + 1];

            // Write sample 3 times
            const offset = i * 3;
            
            // 1
            newBuffer[offset] = sampleLow;
            newBuffer[offset + 1] = sampleHigh;
            // 2
            newBuffer[offset + 2] = sampleLow;
            newBuffer[offset + 3] = sampleHigh;
            // 3
            newBuffer[offset + 4] = sampleLow;
            newBuffer[offset + 5] = sampleHigh;
        }
        return newBuffer;
    }

    // Downsample from 24000Hz to 8000Hz (Output to Twilio)
    // Take every 3rd sample
    static downsample24kTo8k(buffer: Buffer): Buffer {
        // Output size is 1/3 of input size
        const newLength = Math.floor(buffer.length / 3);
        // Ensure even length for 16-bit alignment
        const alignedLength = newLength % 2 === 0 ? newLength : newLength - 1;
        
        const newBuffer = Buffer.alloc(alignedLength);
        
        let outOffset = 0;
        // Iterate input with step of 6 bytes (3 samples * 2 bytes)
        for (let i = 0; i < buffer.length && outOffset < alignedLength; i += 6) {
            if (i + 1 >= buffer.length) break;

            // Copy the first sample of the triplet
            newBuffer[outOffset] = buffer[i];
            newBuffer[outOffset + 1] = buffer[i + 1];
            
            outOffset += 2;
        }
        return newBuffer;
    }
}
