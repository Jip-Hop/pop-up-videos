var titleSuffixCounter = 0;
var data;
var enabled = false;
var popupWidth = 480;
var popupHeight = 270;
var xOffset = screen.availLeft,
  yOffset = screen.availTop;

const initWindowVariables = () => {
  data = { windows: [], videos: [] };
};
initWindowVariables();

chrome.runtime.sendMessage({ type: "load" }, function (response) {
  if (response && response.enabled) {
    enable();
  }
});

chrome.runtime.onMessage.addListener(function (message) {
  if (message && message.enabled) {
    enable();
  } else if (message && message.rerun) {
    enable({ rerun: true });
  } else if (message && message.enabled === false) {
    disable();
  }
});

const closeAllPopups = () => {
  data.windows.forEach((win) => {
    try {
      win.close();
    } catch (e) {
      console.log(e);
    }
  });
};

const disable = () => {
  enabled = false;
  if (data && data.windows) {
    clearTimeout(data.timer);
    closeAllPopups();
    window.removeEventListener("unload", closeAllPopups);
  }

  initWindowVariables();
};

const enable = (options) => {
  if (!options) {
    options = {};
  }

  // Only enable once
  if (enabled && !options.rerun) {
    return;
  }

  enabled = true;

  if (options.rerun) {
    // Remove references to closed windows and videos, so we can reopen them
    data.windows.slice().forEach((win) => {
      if (win.closed) {
        const index = data.windows.indexOf(win);
        if (index > -1) {
          data.windows.splice(index, 1);
          data.videos.splice(index, 1);
        }
      }
    });
  }

  const cssText = `
	* {
		margin: 0;
		padding: 0;
		border: 0;
	}
  
	html, body {
		background: black;
	}
  
	#wrapper {
	  width: 100vw;
	  height: 100vh;      
	}
  
	canvas, video {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
  
	button {
	  position: absolute;
	  bottom: 0;
	  right: 0;
	  padding: 5px;
	  display: none;
	}
  
	body:hover button {
		display: block;
	}
  `;

  window.addEventListener("unload", closeAllPopups);

  (function openVideosInWindow() {
    if (!enabled) {
      return;
    }

    const setTitle = (win, video) => {
      var jitsiDisplayName;
      var parentId = video.parentElement.id;
      var titleSuffix;

      // Jitsi Meet specific code for window titles
      if (parentId && parentId.startsWith("participant_")) {
        jitsiDisplayName = document.querySelector("#" + parentId + "_name");
        if (jitsiDisplayName && jitsiDisplayName.textContent) {
          titleSuffix = jitsiDisplayName.textContent + " [Jitsi]";;
        }
      } else if (video.id && video.id.startsWith("localVideo_container")) {
        jitsiDisplayName = document.querySelector("#localDisplayName");
        if (jitsiDisplayName && jitsiDisplayName.textContent) {
          titleSuffix = jitsiDisplayName.textContent + " [Jitsi]";;
        }
      } else if (video.id) {
        titleSuffix = video.id + " [id]";
      } else if (video.hasAttribute("jiptitlesuffix")) {
        titleSuffix = video.getAttribute("jiptitlesuffix");
      } else {
        titleSuffixCounter++;
        titleSuffix = titleSuffixCounter + " [#]";
        video.setAttribute("jiptitlesuffix", titleSuffix);
      }

      // Window may be temporarily inaccessible when a reload is in process
      try {
        win.document.title = window.location.hostname + " | " + titleSuffix;
      } catch (e) {
        console.log(e);
      }
    };

    const sourceVideos = document.querySelectorAll("video");

    sourceVideos.forEach((video) => {
      const videoIndex = data.videos.indexOf(video);
      var win;

      // Video may not be muted, else it won't play in the background
      const unmute = (video) => {
        if (video.muted) {
          video.volume = 0;
          video.muted = false;
        }
      };
      video.onvolumechange = function () {
        unmute(video);
      };
      unmute(video);

      const onWinLoad = (win) => {
        // Try if we can access the window
        try {
          // Don't setup for closed windows
          if (win.closed) {
            return;
          }
        } catch (e) {
          console.log(e);
          // Don't continue if window isn't accessible temporarily
          setTimeout(() => onWinLoad(win), 1);
          return;
        }

        // Wait for window to be (re)loaded
        if (win.document.readyState !== "complete" || win.willUnload) {
          setTimeout(() => onWinLoad(win), 1);
          return;
        }

        // Keep syncing the title
        setTitle(win, video);

        if (win.hasBeenSetup) {
          return;
        }

        win.hasBeenSetup = true;

        win.onbeforeunload = () => {
          win.willUnload = true;
          onWinLoad(win);
        };

        const css = document.createElement("style");
        css.type = "text/css";
        css.appendChild(document.createTextNode(cssText));
        win.document.head.appendChild(css);

        var wrapper = document.createElement("div");
        wrapper.id = "wrapper";
        win.document.body.appendChild(wrapper);

        try {
          // TODO: maybe check first if there's already a srcObject I can access, so I don't have to capture a new one...
          // In that case I'd have to keep updating the target srcObject if the source changes
          const stream = video.captureStream();
          // TODO: Mappertje integration
          const newVid = win.document.createElement("video");
          newVid.muted = true;
          newVid.autoplay = true;
          newVid.controls = false;
          video.onplay = () => {
            // Keep them linked, also when restarting playback
            newVid.srcObject = video.captureStream();
          };
          newVid.srcObject = stream;
          wrapper.appendChild(newVid);
        } catch (e) {
          // Use canvas as a fallback when captureStream fails due to CORS
          const canvas = win.document.createElement("canvas");
          // TODO: Do captureStream() on canvas for Mappertje integration
          wrapper.appendChild(canvas);

          const ctx = canvas.getContext("2d");

          var fpsInterval, startTime, now, then, elapsed, lastTime;

          const startAnimating = (fps) => {
            fpsInterval = 1000 / fps;
            then = window.performance.now();
            startTime = then;
            drawVideo();
          };

          function drawVideo(newtime) {
            // request another frame

            requestAnimationFrame(drawVideo);

            // calc elapsed time since last loop

            now = newtime;
            elapsed = now - then;

            // if enough time has elapsed, draw the next frame

            if (elapsed > fpsInterval) {
              // Get ready for next frame by setting then=now, but...
              // Also, adjust for fpsInterval not being multiple of 16.67
              then = now - (elapsed % fpsInterval);

              // draw stuff here

              if (video.currentTime !== lastTime) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                lastTime = video.currentTime;
              }
            }
          }

          // Draw at 30fps
          startAnimating(30);
        }

        // TODO: add "Enter" keyboard shortcut for full screen
        const button = win.document.createElement("button");
        button.textContent = "Full Screen";

        button.onclick = () => {
          wrapper.requestFullscreen();
        };

        win.onresize = () => {
          if (win.innerHeight === win.screen.height) {
            // Full screen, also covers case of not using HTML5 fullscreen api
            button.style.display = "none";
          } else {
            button.style.display = "";
          }
        };

        win.document.body.appendChild(button);
      };

      if (videoIndex === -1) {
        win = window.open(
          "about:blank# Move the video and go full screen (bottom right button).",
          performance.now(),
          `status=no,menubar=no,width=${popupWidth},height=${popupHeight},left=${xOffset},top=${yOffset}`
        );

        if (!win) {
          return;
        }

        xOffset += popupWidth;
        if (xOffset + popupWidth > screen.availWidth) {
          xOffset = screen.availLeft;
          yOffset += popupHeight;
        }
        if (yOffset + popupHeight > screen.availHeight) {
          xOffset = screen.availLeft;
          yOffset = screen.availTop;
        }

        if (win.document.readyState === "complete") {
          onWinLoad(win);
        } else {
          win.onload = () => onWinLoad(win);
        }

        data.videos.push(video);
        data.windows.push(win);
      } else {
        win = data.windows[videoIndex];
      }

      onWinLoad(win);
    });
    data.videos.slice().forEach((video) => {
      // Video no longer in source document, close window
      if ([].indexOf.call(sourceVideos, video) === -1) {
        const index = data.videos.indexOf(video);
        if (index > -1) {
          data.windows[index].close();
          data.windows.splice(index, 1);
          data.videos.splice(index, 1);
        }
      }
    });
    data.timer = setTimeout(openVideosInWindow, 1000);
  })();
};
