#!/bin/bash
# Convert ambient audio source to production format
# Usage: ./convert-ambient.sh input.mp3 output_name [start_sec] [end_sec]
#
# Output: mono, 16-bit signed LE, 24kHz PCM (.raw)
# Normalized to -28 LUFS with -6dB true peak ceiling
# Fade in/out for seamless looping

set -e

cd "$(dirname "$0")"
INPUT="$1"
OUTPUT_NAME="$2"
START="${3:-0}"
END="${4:-}"

if [ -z "$INPUT" ] || [ -z "$OUTPUT_NAME" ]; then
    echo "Usage: $0 <input_file> <output_name> [start_sec] [end_sec]"
    echo "Example: $0 office-sound.mp3 office 3 48"
    exit 1
fi

TRIM_FILTER=""
if [ -n "$END" ]; then
    DURATION=$(echo "$END - $START" | bc)
    FADE_OUT=$(echo "$DURATION - 0.2" | bc)
    TRIM_FILTER="atrim=start=${START}:end=${END},"
    FADE_FILTER="afade=t=in:st=0:d=0.1,afade=t=out:st=${FADE_OUT}:d=0.1,"
else
    TRIM_FILTER="atrim=start=${START},"
    FADE_FILTER="afade=t=in:st=0:d=0.1,"
fi

# Generate raw PCM
ffmpeg -y -i "$INPUT" \
    -af "${TRIM_FILTER}loudnorm=I=-28:TP=-6:LRA=7,${FADE_FILTER}aresample=24000" \
    -f s16le -acodec pcm_s16le -ar 24000 -ac 1 \
    "raw/${OUTPUT_NAME}.raw"

# Generate WAV preview
ffmpeg -y -f s16le -ar 24000 -ac 1 -i "raw/${OUTPUT_NAME}.raw" \
    "preview/${OUTPUT_NAME}.wav"

# Verify
echo "=== ${OUTPUT_NAME} ==="
ffmpeg -i "preview/${OUTPUT_NAME}.wav" -af "volumedetect" -f null - 2>&1 | grep -E "mean_volume|max_volume"
SIZE=$(wc -c < "raw/${OUTPUT_NAME}.raw")
echo "Size: $SIZE bytes, Duration: ~$((SIZE / 48000))s"
echo "Format: mono, 16-bit signed LE, 24000 Hz"
