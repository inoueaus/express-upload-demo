class VideoPlayer {
    #viewer;
    #controller;
    #signal;
    #first;
    mediaInfo;
    mediaSource;
    #videoSourceBuffer;
    #videoBufferEventListener;
    #currentVideoTrack;
    #videoSegmentNumber;
    #audioSourceBuffer;
    #audioBufferEventListener;
    #currentAudioTrack;
    #audioSegmentNumber;
    #finalSegmentNumber;
    constructor(viewerElementId) {
        const viewerElement = document.getElementById(viewerElementId);
        if (!(viewerElement instanceof HTMLVideoElement))
            throw Error("Element Id did not yield a valid player element");
        this.#viewer = viewerElement;
        this.#controller = new AbortController();
        this.#signal = this.#controller.signal;
        this.#first = true;
    }
    async loadVideo(MPDFileName) {
        this.mediaInfo = await this.#getMPD(MPDFileName);
        this.mediaSource = new MediaSource();
        const videoTrackName = "240p";
        const audioTrackName = "1";
        this.#currentVideoTrack = this.mediaInfo.tracks.find(track => track.id === videoTrackName);
        this.#currentAudioTrack = this.mediaInfo.tracks.find(track => track.id === audioTrackName);
        if (!(MediaSource.isTypeSupported(this.#currentVideoTrack.type) &&
            MediaSource.isTypeSupported(this.#currentAudioTrack.type)))
            throw Error("unsupported video type");
        this.#videoSegmentNumber = this.#currentVideoTrack.startNumber;
        this.#audioSegmentNumber = this.#currentAudioTrack.startNumber;
        await new Promise((resolve, reject) => {
            this.#viewer.src = URL.createObjectURL(this.mediaSource);
            this.#viewer.onloadedmetadata = event => {
                this.#viewer.onseeked = event => console.log(event);
                this.#viewer.addEventListener("seeking", event => console.log("seeking", event, this.mediaSource.readyState));
                this.#viewer.onerror = () => console.error(this.#viewer.error.message);
                this.#viewer.addEventListener("play", () => {
                    if (this.mediaSource.readyState === "open" && this.#first) {
                        this.#first = false;
                        Promise.all([
                            this.#repeatVideoSegmentLoad(),
                            this.#repeatAudioSegmentLoad(),
                        ]);
                        //.finally(() => this.mediaSource.endOfStream());
                    }
                });
            };
            this.mediaSource.addEventListener("sourceopen", () => resolve(true));
        });
        this.#videoSourceBuffer = this.mediaSource.addSourceBuffer(this.#currentVideoTrack.type);
        this.#audioSourceBuffer = this.mediaSource.addSourceBuffer(this.#currentAudioTrack.type);
        await Promise.all([
            this.#loadVideoSegment(this.#currentVideoTrack.init),
            this.#loadAudioSegment(this.#currentAudioTrack.init),
        ]); // load video info moov atom
        this.#calculateFinalSegmentNumber();
        await Promise.all([this.#loadVideoSegment(), this.#loadAudioSegment()]); // load first segment
    }
    async #repeatVideoSegmentLoad() {
        while (this.#videoSegmentNumber <= this.#finalSegmentNumber) {
            await this.#loadVideoSegment();
        }
    }
    async #repeatAudioSegmentLoad() {
        while (this.#audioSegmentNumber <= this.#finalSegmentNumber) {
            await this.#loadAudioSegment();
        }
    }
    async #getMPD(fileName) {
        const response = await fetch(`/video/${fileName}`);
        if (!response.ok)
            throw Error(`Invalid response: ${response.status}`);
        const text = await response.text();
        const xml = new window.DOMParser().parseFromString(text, "text/xml");
        const tracks = Array.from(xml.getElementsByTagName("AdaptationSet")).reduce((prev, element) => {
            const segmentTemplate = element.getElementsByTagName("SegmentTemplate")[0];
            const representation = element.getElementsByTagName("Representation")[0];
            const id = representation.getAttribute("id");
            const init = segmentTemplate
                .getAttribute("initialization")
                .replace(/\$RepresentationID\$/, id);
            const tracksInAdaptionSet = Array.from(element.getElementsByTagName("Representation")).map(representation => {
                const mimeType = representation.getAttribute("mimeType");
                const id = representation.getAttribute("id");
                const codecs = representation.getAttribute("codecs");
                const type = `${mimeType}; codecs="${codecs}"`;
                const media = segmentTemplate.getAttribute("media");
                const template = media.replace(/\$RepresentationID\$/, id);
                const startNumber = Number(segmentTemplate.getAttribute("startNumber"));
                const segmentLength = Number(segmentTemplate.getAttribute("duration")) /
                    Number(segmentTemplate.getAttribute("timescale"));
                return { id, type, segmentLength, template, init, startNumber };
            });
            return [...prev, ...tracksInAdaptionSet];
        }, []);
        console.log(tracks);
        return {
            tracks,
        };
    }
    async #getSegment(segmentName) {
        const response = await fetch(`/video/stream/${segmentName}`, {
            signal: this.#signal,
        });
        if (!response.ok)
            throw Error(`Invalid response: ${response.status}`);
        return await response.arrayBuffer();
    }
    async #loadVideoSegment(initialSegmentName) {
        const segmentName = initialSegmentName ??
            this.#currentVideoTrack.template.replace(/\$Number\$/, String(this.#videoSegmentNumber));
        const nextSegment = await this.#getSegment(segmentName);
        await new Promise((resolve, reject) => {
            this.#videoSourceBuffer.appendBuffer(nextSegment);
            this.#videoSourceBuffer.removeEventListener("updateend", this.#videoBufferEventListener);
            this.#videoBufferEventListener = () => resolve(true);
            this.#videoSourceBuffer.addEventListener("updateend", this.#videoBufferEventListener);
        });
        if (!initialSegmentName)
            this.#videoSegmentNumber++; // increment if not loading initial
    }
    async #loadAudioSegment(initialSegmentName) {
        const segmentName = initialSegmentName ??
            this.#currentAudioTrack.template.replace(/\$Number\$/, String(this.#audioSegmentNumber));
        const nextSegment = await this.#getSegment(segmentName);
        await new Promise((resolve, reject) => {
            this.#audioSourceBuffer.appendBuffer(nextSegment);
            this.#audioSourceBuffer.removeEventListener("updateend", this.#audioBufferEventListener);
            this.#audioBufferEventListener = () => resolve(true);
            this.#audioSourceBuffer.addEventListener("updateend", this.#audioBufferEventListener);
        });
        if (!initialSegmentName)
            this.#audioSegmentNumber++; // increment if not loading initial
    }
    #calculateFinalSegmentNumber() {
        const videoLength = this.mediaSource.duration;
        const segmentLength = this.#currentVideoTrack.segmentLength;
        this.#finalSegmentNumber = Math.ceil(videoLength / segmentLength);
        console.log(this.#finalSegmentNumber);
    }
    changeVideoTrack(trackName) {
        this.#currentVideoTrack = this.mediaInfo.tracks.find(track => track.id === trackName);
        if (!MediaSource.isTypeSupported(this.#currentVideoTrack.type)) {
            throw Error("unsupported video type");
        }
        this.#videoSegmentNumber =
            Math.floor(this.#viewer.currentTime / this.#currentVideoTrack.segmentLength) + 1;
        this.#loadVideoSegment(this.#currentVideoTrack.init)
            .then(() => {
            return this.#repeatVideoSegmentLoad();
        })
            .then(() => {
            this.#videoSegmentNumber = 1;
            return this.#repeatVideoSegmentLoad();
        });
    }
    changeAudioTrack(trackName) {
        this.#currentAudioTrack = this.mediaInfo.tracks.find(track => track.id === trackName);
        if (!MediaSource.isTypeSupported(this.#currentAudioTrack.type)) {
            throw Error("unsupported video type");
        }
        this.#audioSegmentNumber =
            Math.floor(this.#viewer.currentTime / this.#currentAudioTrack.segmentLength) + 1;
        this.#loadAudioSegment(this.#currentAudioTrack.init)
            .then(() => {
            return this.#repeatAudioSegmentLoad();
        })
            .then(() => {
            this.#videoSegmentNumber = 1;
            return this.#repeatAudioSegmentLoad();
        });
    }
}
const pad = (num, padSize) => {
    const numString = String(num);
    const numStringLength = numString.length;
    const padBase = "0";
    let pad = "";
    for (let i = 0; i < padSize - numStringLength; i++) {
        pad = pad + padBase;
    }
    return pad + numString;
};
export default VideoPlayer;
//# sourceMappingURL=video-player.js.map