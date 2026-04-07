export class Config {
  public static JM_VERSION = "2.0.13";
  public static JM_SECRET = "185Hcomic3PAPP7R";
  public static JM_CACHE_SCOPE = "JmComic";

  public static baseUrlIndex = 0;

  public static baseUrls = [
    "https://www.cdnsha.org",
    "https://www.cdnbea.cc",
    "https://www.cdnbea.net",
    "https://www.cdn-mspjmapiproxy.xyz",
  ];

  public static get baseUrl(): string {
    return this.baseUrls[this.baseUrlIndex] ?? this.baseUrls[0] ?? "";
  }

  public static imagesUrlIndex = 0;

  public static imagesUrls = [
    "https://cdn-msp12.jmdanjonproxy.xyz",
    "https://cdn-msp.jmapiproxy1.cc",
    "https://cdn-msp2.jmdanjonproxy.vip",
    "https://cdn-msp.jmdanjonproxy.vip",
    "https://cdn-msp.jmapiproxy1.cc",
  ];

  public static get imagesUrl(): string {
    return this.imagesUrls[this.imagesUrlIndex] ?? this.imagesUrls[0] ?? "";
  }
}
