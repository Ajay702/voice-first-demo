#!/bin/sh
# Puts the recorded voice-overs onto the screen videos and joins both parts.
#   sh merge.sh      ->  final/part1.mp4, final/part2.mp4, final/demo.mp4
set -eu
cd "$(dirname "$0")"
mkdir -p final

for part in part1 part2; do
  [ -f "voice/$part.webm" ] || { echo "Missing voice/$part.webm: record it first"; exit 1; }
  # Even loudness for YouTube; pad with silence so the audio lasts as long as the picture.
  ffmpeg -loglevel error -y -i "out/$part.mp4" -i "voice/$part.webm" \
    -map 0:v -map 1:a -c:v copy -af "loudnorm=I=-16:TP=-1.5,apad" -c:a aac -b:a 192k -ar 48000 \
    -shortest "final/$part.mp4"
  echo "final/$part.mp4"
done

printf "file 'part1.mp4'\nfile 'part2.mp4'\n" > final/list.txt
ffmpeg -loglevel error -y -f concat -safe 0 -i final/list.txt -c copy -movflags +faststart final/demo.mp4
rm final/list.txt
echo "final/demo.mp4 ($(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 final/demo.mp4 | cut -d. -f1)s)"
