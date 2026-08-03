import { useEffect, useRef, useState } from "react";

export type AmbientScene = "chromatic" | "chromatic-deep";

const materialSources = [
  "/assets/ambient/chromatic-polymer-light-v1.webp",
  "/assets/ambient/chromatic-polymer-dark-v1.webp",
];

export function chooseAmbientScene(_module: string, theme: string, _hour?: number): AmbientScene {
  // 页面身份只由图标表达，整个应用始终共享同一套多色环境；
  // 只有明暗主题切换对应的摄影素材，避免“一个模块一张皮肤”。
  void _module;
  void _hour;
  return theme === "dark" ? "chromatic-deep" : "chromatic";
}

export function AmbientEnvironment({ scene }: { scene: AmbientScene }) {
  const activeScene = useRef(scene);
  const [layers, setLayers] = useState<{ current: AmbientScene; previous: AmbientScene | null; version: number }>({
    current: scene,
    previous: null,
    version: 0,
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      materialSources.forEach((source) => { const image = new Image(); image.src = source; });
    }, 400);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (activeScene.current === scene) return;
    const previous = activeScene.current;
    activeScene.current = scene;
    setLayers((value) => ({ current: scene, previous, version: value.version + 1 }));
    const timer = window.setTimeout(() => {
      setLayers((value) => value.current === scene ? { ...value, previous: null } : value);
    }, 960);
    return () => window.clearTimeout(timer);
  }, [scene]);

  return (
    <div className="ambient-environment" data-scene={layers.current} aria-hidden="true">
      {layers.previous ? <div className={`ambient-environment__image ambient-scene-${layers.previous} is-previous`} /> : null}
      <div key={`${layers.current}-${layers.version}`} className={`ambient-environment__image ambient-scene-${layers.current} is-current`} />
    </div>
  );
}
