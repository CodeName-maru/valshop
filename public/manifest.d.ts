declare module "*.webmanifest" {
  const value: {
    name: string;
    short_name: string;
    start_url: string;
    display: string;
    background_color: string;
    theme_color: string;
    scope: string;
    lang: string;
    icons: Array<{
      src: string;
      sizes: string;
      type: string;
      purpose: string;
    }>;
  };
  export default value;
}

declare module "*.json" {
  const value: any;
  export default value;
}
