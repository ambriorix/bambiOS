import { join } from "path";
import { useTheme } from "styled-components";
import { useCallback, useEffect, useRef } from "react";
import {
  BASE_CANVAS_SELECTOR,
  BASE_VIDEO_SELECTOR,
  WALLPAPER_PATHS,
  WALLPAPER_WORKERS,
  bgPositionSize,
} from "components/system/Desktop/Wallpapers/constants";
import { type WallpaperConfig } from "components/system/Desktop/Wallpapers/types";
import { config as vantaConfig } from "components/system/Desktop/Wallpapers/vantaWaves/config";
import { useFileSystem } from "contexts/fileSystem";
import { useSession } from "contexts/session";
import useWorker from "hooks/useWorker";
import {
  BG_TRANSITION_MS,
  DEFAULT_LOCALE,
  IMAGE_FILE_EXTENSIONS,
  MILLISECONDS_IN_DAY,
  MILLISECONDS_IN_MINUTE,
  PICTURES_FOLDER,
  PROMPT_FILE,
  SLIDESHOW_FILE,
  SLIDESHOW_TIMEOUT_IN_MILLISECONDS,
  UNSUPPORTED_SLIDESHOW_EXTENSIONS,
  VIDEO_FILE_EXTENSIONS,
} from "utils/constants";
import {
  bufferToUrl,
  cleanUpBufferUrl,
  createOffscreenCanvas,
  getExtension,
  getYouTubeUrlId,
  isBeforeBg,
  isYouTubeUrl,
  jsonFetch,
  parseBgPosition,
  viewWidth,
} from "utils/functions";

declare global {
  interface Window {
    DEBUG_DISABLE_WALLPAPER?: boolean;
    WallpaperDestroy?: () => void;
  }
}

type WallpaperMessage = { message: string; type: string };

const WALLPAPER_WORKER_NAMES = Object.keys(WALLPAPER_WORKERS);
const REDUCED_MOTION_PERCENT = 0.1;

const slideshowFiles: string[] = [];

const useWallpaper = (
  desktopRef: React.MutableRefObject<HTMLElement | null>
): void => {
  const { exists, lstat, readFile, readdir, updateFolder, writeFile } =
    useFileSystem();
  const { sessionLoaded, setWallpaper, wallpaperImage, wallpaperFit } =
    useSession();
  const { colors } = useTheme();
  const [wallpaperName] = wallpaperImage.split(" ");
  const vantaWireframe = wallpaperImage === "VANTA WIREFRAME";
  const wallpaperWorker = useWorker<void>(
    WALLPAPER_WORKERS[wallpaperName],
    undefined,
    vantaWireframe ? "Wireframe" : ""
  );
  const wallpaperTimerRef = useRef<number>();
  const failedOffscreenContext = useRef(false);
  const loadWallpaper = useCallback(
    async (keepCanvas?: boolean) => {
      if (!desktopRef.current) return;

      let config: WallpaperConfig | undefined;
      const { matches: prefersReducedMotion } = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      );
      let isTopWindow = !window.top || window === window.top;

      if (!isTopWindow) {
        try {
          isTopWindow = window.location.origin !== window.top?.location.origin;
        } catch {
          // Can't read origin, assume top window
          isTopWindow = true;
        }
      }

      if (wallpaperName === "VANTA") {
        config = {
          ...vantaConfig,
          waveSpeed:
            vantaConfig.waveSpeed *
            (prefersReducedMotion ? REDUCED_MOTION_PERCENT : 1),
        };
        vantaConfig.material.options.wireframe = vantaWireframe || !isTopWindow;
      } else if (wallpaperImage.startsWith("MATRIX")) {
        config = {
          animationSpeed: prefersReducedMotion ? REDUCED_MOTION_PERCENT : 1,
          volumetric: wallpaperImage.endsWith("3D"),
          ...(isTopWindow
            ? {}
            : {
                fallSpeed: -0.09,
                forwardSpeed: -0.25,
              }),
        };
      } else if (wallpaperName === "STABLE_DIFFUSION") {
        const promptsFilePath = `${PICTURES_FOLDER}/${PROMPT_FILE}`;

        if (await exists(promptsFilePath)) {
          config = {
            prompts: JSON.parse(
              (await readFile(promptsFilePath))?.toString() || "[]"
            ) as [string, string][],
          };
        }
      }

      document.documentElement.style.setProperty(
        "background",
        document.documentElement.style.background.replace(/".*"/, "")
      );

      if (!keepCanvas) {
        desktopRef.current.querySelector(BASE_CANVAS_SELECTOR)?.remove();

        window.WallpaperDestroy?.();
      }

      if (
        !failedOffscreenContext.current &&
        window.OffscreenCanvas !== undefined &&
        wallpaperWorker.current
      ) {
        const workerConfig = { config, devicePixelRatio: 1 };

        if (keepCanvas) {
          wallpaperWorker.current.postMessage(workerConfig);
        } else {
          const offscreen = createOffscreenCanvas(desktopRef.current);

          wallpaperWorker.current.postMessage(
            { canvas: offscreen, ...workerConfig },
            [offscreen]
          );

          wallpaperWorker.current.addEventListener(
            "message",
            ({ data }: { data: WallpaperMessage }) => {
              if (data.type === "[error]") {
                if (data.message.includes("getContext")) {
                  failedOffscreenContext.current = true;
                  loadWallpaper();
                } else {
                  setWallpaper("SLIDESHOW");
                }
              }
            }
          );
          if (wallpaperName === "STABLE_DIFFUSION") {
            const loadingStatus = document.createElement("div");

            loadingStatus.id = "loading-status";

            desktopRef.current?.append(loadingStatus);

            window.WallpaperDestroy = () => {
              loadingStatus.remove();
              window.WallpaperDestroy = undefined;
            };

            wallpaperWorker.current.addEventListener(
              "message",
              ({ data }: { data: WallpaperMessage }) => {
                if (data.type === "[error]") {
                  setWallpaper("VANTA");
                } else if (data.type) {
                  loadingStatus.textContent = data.message || "";
                } else if (!data.message) {
                  wallpaperTimerRef.current = window.setTimeout(
                    () => loadWallpaper(true),
                    MILLISECONDS_IN_MINUTE * 10
                  );
                }

                loadingStatus.style.display = data.message ? "block" : "none";
              }
            );
          }
        }
      } else if (WALLPAPER_PATHS[wallpaperName]) {
        const fallbackWallpaper = (): void =>
          setWallpaper(wallpaperName === "VANTA" ? "SLIDESHOW" : "VANTA");

        WALLPAPER_PATHS[wallpaperName]()
          .then(({ default: wallpaper }) =>
            wallpaper?.(desktopRef.current, config, fallbackWallpaper)
          )
          .catch(fallbackWallpaper);
      } else {
        setWallpaper("VANTA");
      }
    },
    [
      desktopRef,
      exists,
      readFile,
      setWallpaper,
      vantaWireframe,
      wallpaperImage,
      wallpaperName,
      wallpaperWorker,
    ]
  );
  const getAllImages = useCallback(
    async (baseDirectory: string): Promise<string[]> =>
      (await readdir(baseDirectory)).reduce<Promise<string[]>>(
        async (images, entry) => {
          const entryPath = join(baseDirectory, entry);

          return [
            ...(await images),
            ...((await lstat(entryPath)).isDirectory()
              ? await getAllImages(entryPath)
              : [
                  IMAGE_FILE_EXTENSIONS.has(getExtension(entryPath)) &&
                  !UNSUPPORTED_SLIDESHOW_EXTENSIONS.has(getExtension(entryPath))
                    ? entryPath
                    : "",
                ]),
          ].filter(Boolean);
        },
        Promise.resolve([])
      ),
    [readdir, lstat]
  );
  const loadFileWallpaper = useCallback(async () => {
    let [, currentWallpaperUrl] =
      /url\((.*)\)/.exec(
        document.documentElement.style.getPropertyValue(
          isBeforeBg() ? "--before-background" : "--after-background"
        )
      ) || [];

    currentWallpaperUrl = currentWallpaperUrl?.replace(/\\/g, "");

    if (currentWallpaperUrl?.startsWith("blob:")) {
      cleanUpBufferUrl(currentWallpaperUrl);
    }

    desktopRef.current?.querySelector(BASE_CANVAS_SELECTOR)?.remove();
    desktopRef.current?.querySelector(BASE_VIDEO_SELECTOR)?.remove();

    window.WallpaperDestroy?.();

    let wallpaperUrl = "";
    let fallbackBackground = "";
    let newWallpaperFit = wallpaperFit;
    const isSlideshow = wallpaperName === "SLIDESHOW";

    if (!isSlideshow) {
      document.documentElement.style.removeProperty("--after-background");
      document.documentElement.style.removeProperty("--before-background");
    }

    if (isSlideshow) {
      const slideshowFilePath = `${PICTURES_FOLDER}/${SLIDESHOW_FILE}`;

      if (!(await exists(slideshowFilePath))) {
        await writeFile(
          slideshowFilePath,
          JSON.stringify(
            (await exists(PICTURES_FOLDER))
              ? await getAllImages(PICTURES_FOLDER)
              : "[]"
          )
        );
        updateFolder(PICTURES_FOLDER, SLIDESHOW_FILE);
      }

      if (slideshowFiles.length === 0) {
        slideshowFiles.push(
          ...[
            ...new Set(
              JSON.parse(
                (await readFile(slideshowFilePath))?.toString() || "[]"
              ) as string[]
            ),
          ].sort(() => Math.random() - 0.5)
        );
      }

      do {
        wallpaperUrl = slideshowFiles.shift() || "";

        let [nextWallpaper] = slideshowFiles;

        if (nextWallpaper) {
          const preloadLink = document.createElement("link");

          if (nextWallpaper.startsWith("/")) {
            nextWallpaper = `${window.location.origin}${nextWallpaper}`;
          }

          preloadLink.id = "preloadWallpaper";
          preloadLink.href = nextWallpaper;
          preloadLink.rel = "preload";
          preloadLink.as = "image";

          document.querySelector("#preloadWallpaper")?.remove();
          document.head.append(preloadLink);
        }

        if (wallpaperUrl.startsWith("/")) {
          wallpaperUrl = `${window.location.origin}${wallpaperUrl}`;
        }
      } while (
        currentWallpaperUrl === wallpaperUrl &&
        slideshowFiles.length > 1
      );

      newWallpaperFit = "fill";
    } else if (wallpaperName === "APOD") {
      const [, currentDate] = wallpaperImage.split(" ");
      const [month, , day, , year] = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
        timeZone: "US/Eastern",
      })
        .formatToParts(Date.now())
        .map(({ value }) => value);

      if (currentDate === `${year}-${month}-${day}`) return;

      const {
        date = "",
        hdurl = "",
        url = "",
      } = await jsonFetch(
        "https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY"
      );

      if (hdurl || url) {
        wallpaperUrl = ((viewWidth() > 1024 ? hdurl : url) || url) as string;
        newWallpaperFit = "fit";

        if (isYouTubeUrl(wallpaperUrl)) {
          const ytBaseUrl = `https://i.ytimg.com/vi/${getYouTubeUrlId(
            wallpaperUrl
          )}`;

          wallpaperUrl = `${ytBaseUrl}/maxresdefault.jpg`;
          fallbackBackground = `${ytBaseUrl}/hqdefault.jpg`;
        } else if (hdurl && url && hdurl !== url) {
          fallbackBackground = (wallpaperUrl === url ? hdurl : url) as string;
        }

        const newWallpaperImage = `APOD ${wallpaperUrl} ${date as string}`;

        if (newWallpaperImage !== wallpaperImage) {
          setWallpaper(newWallpaperImage, newWallpaperFit);
          setTimeout(loadWallpaper, MILLISECONDS_IN_DAY);
        }
      }
    } else if (await exists(wallpaperImage)) {
      const { decodeImageToBuffer } = await import("utils/imageDecoder");
      const fileData = await readFile(wallpaperImage);
      const imageBuffer = await decodeImageToBuffer(
        getExtension(wallpaperImage),
        fileData
      );

      wallpaperUrl = bufferToUrl(imageBuffer || fileData);
    }

    if (wallpaperUrl) {
      if (VIDEO_FILE_EXTENSIONS.has(getExtension(wallpaperImage))) {
        const video = document.createElement("video");

        video.src = wallpaperUrl;

        video.autoplay = true;
        video.controls = false;
        video.disablePictureInPicture = true;
        video.disableRemotePlayback = true;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;

        video.style.position = "absolute";
        video.style.inset = "0";
        video.style.width = "100%";
        video.style.height = "100%";
        video.style.objectFit = "cover";
        video.style.objectPosition = "center center";
        video.style.zIndex = "-1";

        desktopRef.current?.append(video);
      } else {
        const applyWallpaper = (url: string): void => {
          let positionSize = bgPositionSize[newWallpaperFit];

          if (isSlideshow) {
            try {
              const { searchParams } = new URL(url);
              const { x, y } = Object.fromEntries(searchParams.entries());

              positionSize = `${parseBgPosition(x)} ${parseBgPosition(y)} / cover`;
            } catch {
              // Ignore failure to specify background position
            }
          }

          const repeat = newWallpaperFit === "tile" ? "repeat" : "no-repeat";
          const isTopWindow = window === window.top;
          const isAfterNextBackground = isBeforeBg();
          const selectorBackground = isAfterNextBackground ? "after" : "before";
          const delayTransition =
            document.documentElement.style.getPropertyValue(
              `--${selectorBackground}-background`
            );

          setTimeout(
            () => {
              document.documentElement.style.setProperty(
                "--after-background-opacity",
                isAfterNextBackground ? "1" : "0"
              );
              document.documentElement.style.setProperty(
                "--before-background-opacity",
                isAfterNextBackground ? "0" : "1"
              );
            },
            delayTransition && isSlideshow ? BG_TRANSITION_MS : 0
          );

          document.documentElement.style.setProperty(
            `--${selectorBackground}-background`,
            `url(${CSS.escape(
              url
            )}) ${positionSize} ${repeat} fixed border-box border-box ${
              isTopWindow ? colors.background : colors.text
            }`
          );

          if (!isTopWindow) {
            document.documentElement.style.setProperty(
              "--background-blend-mode",
              "difference"
            );
          }
        };

        if (fallbackBackground) {
          const checkImg = new Image();

          checkImg.addEventListener("load", () => applyWallpaper(wallpaperUrl));
          checkImg.addEventListener("error", () =>
            applyWallpaper(fallbackBackground)
          );
          checkImg.src = wallpaperUrl;
        } else {
          applyWallpaper(wallpaperUrl);

          if (isSlideshow) {
            wallpaperTimerRef.current = window.setTimeout(
              loadFileWallpaper,
              SLIDESHOW_TIMEOUT_IN_MILLISECONDS
            );
          }
        }
      }
    } else {
      loadWallpaper();
    }
  }, [
    colors,
    desktopRef,
    exists,
    getAllImages,
    loadWallpaper,
    readFile,
    setWallpaper,
    updateFolder,
    wallpaperFit,
    wallpaperImage,
    wallpaperName,
    writeFile,
  ]);

  useEffect(() => {
    if (sessionLoaded && !window.DEBUG_DISABLE_WALLPAPER) {
      if (wallpaperTimerRef.current) {
        window.clearTimeout(wallpaperTimerRef.current);
      }

      if (wallpaperName && !WALLPAPER_WORKER_NAMES.includes(wallpaperName)) {
        loadFileWallpaper().catch(loadWallpaper);
      } else {
        loadWallpaper();
      }
    }
  }, [loadFileWallpaper, loadWallpaper, sessionLoaded, wallpaperName]);

  useEffect(() => {
    const resizeListener = (): void => {
      if (!desktopRef.current || !WALLPAPER_PATHS[wallpaperName]) return;

      const desktopRect = desktopRef.current.getBoundingClientRect();

      wallpaperWorker.current?.postMessage(desktopRect);

      const canvasElement =
        desktopRef.current.querySelector(BASE_CANVAS_SELECTOR);

      if (canvasElement instanceof HTMLCanvasElement) {
        canvasElement.style.width = `${desktopRect.width}px`;
        canvasElement.style.height = `${desktopRect.height}px`;
      }
    };

    window.addEventListener("resize", resizeListener, { passive: true });

    return () => window.removeEventListener("resize", resizeListener);
  }, [desktopRef, wallpaperName, wallpaperWorker]);
};

export default useWallpaper;
