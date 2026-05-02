export class Config {
  public static JM_VERSION = "2.0.20";
  public static JM_SECRET = "185Hcomic3PAPP7R";
  public static JM_CACHE_SCOPE = "JmComic";
  public static JM_HOSTCFG_AES_SEED = "diosfjckwpqpdfjkvnqQjsik";
  public static JM_SETTING_AES_SEEDS = [
    "185Hcomic3PAPP7R",
    "18comicAPPContent",
  ];
  public static JM_HOST_CONFIG_URLS = [
    "https://rup4a04-c02.tos-cn-hongkong.bytepluses.com/newsvr-2025.txt",
    "https://rup4a04-c01.tos-ap-southeast-1.bytepluses.com/newsvr-2025.txt",
  ];
  public static JM_FALLBACK_API_BASE = "https://www.cdnhjk.net";
  public static JM_FALLBACK_IMAGE_BASE =
    "https://cdn-msp3.jmdanjonproxy.vip";

  public static baseUrlIndex = 0;

  public static baseUrls = [Config.JM_FALLBACK_API_BASE];

  public static get baseUrl(): string {
    return this.baseUrls[this.baseUrlIndex] ?? this.baseUrls[0] ?? "";
  }

  public static imagesUrlIndex = 0;

  public static imagesUrls = [Config.JM_FALLBACK_IMAGE_BASE];

  public static get imagesUrl(): string {
    return this.imagesUrls[this.imagesUrlIndex] ?? this.imagesUrls[0] ?? "";
  }
}
