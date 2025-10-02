import React from "react";

const YoutubeShortEmbed = () => {
  return (
    <div className="w-full flex justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-lg overflow-hidden max-w-sm w-full">
        {/* Video Container */}
        <div className="relative w-full aspect-[9/16]">
          <iframe
            className="absolute top-0 left-0 w-full h-full"
            src="https://www.youtube.com/embed/QFPQuH-bLWI"
            title="YouTube Shorts Video"
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          ></iframe>
        </div>
      </div>
    </div>
  );
};

export default YoutubeShortEmbed;
