const JM_PLUGIN_ID = "bf99008d-010b-4f17-ac7c-61a9b57dc3d9";

type Scene = Record<string, unknown>;

type BuildPluginInfoInput = {
  buildLatestScene: () => Scene;
  buildRankingScene: () => Scene;
};

export function buildPluginInfo(input: BuildPluginInfoInput) {
  return {
    name: "禁漫天堂",
    uuid: JM_PLUGIN_ID,
    iconUrl:
      "https://raw.githubusercontent.com/deretame/Breeze-plugin-JmComic/main/assets/fO.png",
    creator: {
      name: "",
      describe: "",
    },
    describe: "禁漫天堂插件",
    version: "0.0.2",
    home: "https://github.com/deretame/Breeze-plugin-JmComic",
    updateUrl:
      "https://api.github.com/repos/deretame/Breeze-plugin-JmComic/releases/latest",
    function: [
      {
        id: "recommend",
        title: "推荐",
        action: {
          type: "openPluginFunction",
          payload: {
            id: "recommend",
            title: "推荐",
            presentation: "page",
          },
        },
      },
      {
        id: "latest",
        title: "最新",
        action: {
          type: "openComicList",
          payload: { scene: input.buildLatestScene() },
        },
      },
      {
        id: "ranking",
        title: "排行榜",
        action: {
          type: "openComicList",
          payload: { scene: input.buildRankingScene() },
        },
      },
      {
        id: "cloudFavorite",
        title: "云端收藏",
        action: {
          type: "openCloudFavorite",
          payload: { title: "云端收藏" },
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
