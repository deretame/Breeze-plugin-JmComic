import type { ComicListScene } from "breeze-plugin-kit";

const JM_PLUGIN_ID = "bf99008d-010b-4f17-ac7c-61a9b57dc3d9";

type Scene = Record<string, unknown>;

type BuildPluginInfoInput = {
  buildLatestScene: () => Scene;
  buildRankingScene: () => Scene;
};

export function buildJmCloudFavoriteScene(): ComicListScene {
  return {
    title: "云端收藏",
    source: JM_PLUGIN_ID,
    body: {
      type: "pluginPagedComicList",
      request: {
        fnPath: "getCloudFavoriteData",
        core: {},
        extern: { source: "cloudFavorite", order: "mr", folderId: "" },
      },
    },
    filter: {
      fnPath: "getCloudFavoriteFilterBundle",
      core: {},
      extern: { source: "cloudFavorite" },
    },
  };
}

export function buildPluginInfo(input: BuildPluginInfoInput) {
  return {
    name: "禁漫天堂",
    uuid: JM_PLUGIN_ID,
    iconUrl: "https://raw.githubusercontent.com/deretame/Breeze-plugin-JmComic/main/assets/fO.webp",
    describe: "禁漫天堂插件",
    version: "0.0.12",
    home: "https://github.com/deretame/Breeze-plugin-JmComic",
    updateUrl: "https://api.github.com/repos/deretame/Breeze-plugin-JmComic/releases/latest",
    npmName: "breeze-plugin-jm-comic",
    function: [
      {
        id: "recommend",
        title: "推荐",
        action: {
          type: "openPluginFunction" as const,
          payload: {
            id: "recommend",
            title: "推荐",
            presentation: "page" as const,
          },
        },
      },
      {
        id: "latest",
        title: "最新",
        action: {
          type: "openComicList" as const,
          payload: { scene: input.buildLatestScene() },
        },
      },
      {
        id: "ranking",
        title: "排行榜",
        action: {
          type: "openComicList" as const,
          payload: { scene: input.buildRankingScene() },
        },
      },
      {
        id: "cloudFavorite",
        title: "云端收藏",
        action: {
          type: "openComicList" as const,
          payload: { scene: buildJmCloudFavoriteScene() },
        },
      },
    ],
  };
}

function buildManifestComicListScene(input: {
  title: string;
  list: {
    fnPath: string;
    core?: Record<string, unknown>;
    extern?: Record<string, unknown>;
  };
  filter?: {
    fnPath: string;
    core?: Record<string, unknown>;
    extern?: Record<string, unknown>;
  };
}) {
  return {
    title: input.title,
    source: JM_PLUGIN_ID,
    list: {
      fnPath: input.list.fnPath,
      core: input.list.core ?? {},
      extern: input.list.extern ?? {},
    },
    ...(input.filter
      ? {
          filter: {
            fnPath: input.filter.fnPath,
            core: input.filter.core ?? {},
            extern: input.filter.extern ?? {},
          },
        }
      : {}),
  };
}

export function buildManifestInfo() {
  return buildPluginInfo({
    buildLatestScene: () =>
      buildManifestComicListScene({
        title: "最新",
        list: {
          fnPath: "getLatestData",
          extern: { source: "latest" },
        },
      }),
    buildRankingScene: () =>
      buildManifestComicListScene({
        title: "禁漫排行榜",
        list: {
          fnPath: "getRankingData",
          extern: { source: "ranking" },
        },
        filter: {
          fnPath: "getRankingFilterBundle",
          extern: { source: "ranking" },
        },
      }),
  });
}
