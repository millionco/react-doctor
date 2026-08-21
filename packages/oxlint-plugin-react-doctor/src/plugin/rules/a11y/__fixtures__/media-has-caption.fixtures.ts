// GENERATED FROM OXC — do not edit by hand. Run `pnpm gen:fixtures` to regenerate.
// Source: oxc-project/oxc `crates/oxc_linter/src/rules/jsx_a11y/media_has_caption.rs`
// Each entry is a verbatim port of an OXC `pass`/`fail` vec entry.
// `oxcOptions` (optional) is OXC's first config arg (`Some(json!([…]))`),
// preserved as JS for tests that want to translate it. `oxcSettings`
// (optional) mirrors the third tuple slot used for plugin settings.

export interface OxcFixture {
  code: string;
  oxcOptions?: unknown;
  oxcSettings?: unknown;
  oxcFilename?: string;
}

export const passCases: ReadonlyArray<OxcFixture> = [
  { code: `<div />;` },
  { code: `<MyDiv />;` },
  { code: `<audio><track kind='captions' /></audio>` },
  { code: `<audio><track kind='Captions' /></audio>` },
  { code: `<audio><track kind='Captions' /><track kind='subtitles' /></audio>` },
  { code: `<video><track kind='captions' /></video>` },
  { code: `<video><track kind='Captions' /></video>` },
  { code: `<video><track kind='Captions' /><track kind='subtitles' /></video>` },
  { code: `<audio muted={true}></audio>` },
  { code: `<video muted={true}></video>` },
  { code: `<video muted></video>` },
  {
    code: `<Audio><track kind='captions' /></Audio>`,
    oxcOptions: [
      {
        audio: ["Audio"],
        video: ["Video"],
        track: ["Track"],
      },
    ],
  },
  {
    code: `<audio><Track kind='captions' /></audio>`,
    oxcOptions: [
      {
        audio: ["Audio"],
        video: ["Video"],
        track: ["Track"],
      },
    ],
  },
  {
    code: `<Video><track kind='captions' /></Video>`,
    oxcOptions: [
      {
        audio: ["Audio"],
        video: ["Video"],
        track: ["Track"],
      },
    ],
  },
  {
    code: `<video><Track kind='captions' /></video>`,
    oxcOptions: [
      {
        audio: ["Audio"],
        video: ["Video"],
        track: ["Track"],
      },
    ],
  },
  {
    code: `<Audio><Track kind='captions' /></Audio>`,
    oxcOptions: [
      {
        audio: ["Audio"],
        video: ["Video"],
        track: ["Track"],
      },
    ],
  },
  {
    code: `<Video><Track kind='captions' /></Video>`,
    oxcOptions: [
      {
        audio: ["Audio"],
        video: ["Video"],
        track: ["Track"],
      },
    ],
  },
  {
    code: `<Video muted></Video>`,
    oxcOptions: [
      {
        audio: ["Audio"],
        video: ["Video"],
        track: ["Track"],
      },
    ],
  },
  {
    code: `<Video muted={true}></Video>`,
    oxcOptions: [
      {
        audio: ["Audio"],
        video: ["Video"],
        track: ["Track"],
      },
    ],
  },
  {
    code: `<Audio muted></Audio>`,
    oxcOptions: [
      {
        audio: ["Audio"],
        video: ["Video"],
        track: ["Track"],
      },
    ],
  },
  {
    code: `<Audio muted={true}></Audio>`,
    oxcOptions: [
      {
        audio: ["Audio"],
        video: ["Video"],
        track: ["Track"],
      },
    ],
  },
  {
    code: `<Audio><track kind='captions' /></Audio>`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          polymorphicPropName: "as",
          components: {
            Audio: "audio",
            Video: "video",
            Track: "track",
          },
        },
      },
    },
  },
  {
    code: `<audio><Track kind='captions' /></audio>`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          polymorphicPropName: "as",
          components: {
            Audio: "audio",
            Video: "video",
            Track: "track",
          },
        },
      },
    },
  },
  {
    code: `<Video><track kind='captions' /></Video>`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          polymorphicPropName: "as",
          components: {
            Audio: "audio",
            Video: "video",
            Track: "track",
          },
        },
      },
    },
  },
  {
    code: `<video><Track kind='captions' /></video>`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          polymorphicPropName: "as",
          components: {
            Audio: "audio",
            Video: "video",
            Track: "track",
          },
        },
      },
    },
  },
  {
    code: `<Audio><Track kind='captions' /></Audio>`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          polymorphicPropName: "as",
          components: {
            Audio: "audio",
            Video: "video",
            Track: "track",
          },
        },
      },
    },
  },
  {
    code: `<Video><Track kind='captions' /></Video>`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          polymorphicPropName: "as",
          components: {
            Audio: "audio",
            Video: "video",
            Track: "track",
          },
        },
      },
    },
  },
  {
    code: `<Video muted></Video>`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          polymorphicPropName: "as",
          components: {
            Audio: "audio",
            Video: "video",
            Track: "track",
          },
        },
      },
    },
  },
  {
    code: `<Video muted={true}></Video>`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          polymorphicPropName: "as",
          components: {
            Audio: "audio",
            Video: "video",
            Track: "track",
          },
        },
      },
    },
  },
  {
    code: `<Audio muted></Audio>`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          polymorphicPropName: "as",
          components: {
            Audio: "audio",
            Video: "video",
            Track: "track",
          },
        },
      },
    },
  },
  {
    code: `<Audio muted={true}></Audio>`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          polymorphicPropName: "as",
          components: {
            Audio: "audio",
            Video: "video",
            Track: "track",
          },
        },
      },
    },
  },
  {
    code: `<Box as='audio' muted={true}></Box>`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          polymorphicPropName: "as",
          components: {
            Audio: "audio",
            Video: "video",
            Track: "track",
          },
        },
      },
    },
  },
];

export const failCases: ReadonlyArray<OxcFixture> = [
  { code: `<audio><track /></audio>` },
  { code: `<audio><track kind='subtitles' /></audio>` },
  { code: `<audio />` },
  { code: `<video><track /></video>` },
  { code: `<video><track kind='subtitles' /></video>` },
  {
    code: `<Audio muted={false}></Audio>`,
    oxcOptions: [
      {
        audio: ["Audio"],
        video: ["Video"],
        track: ["Track"],
      },
    ],
  },
  {
    code: `<Video muted={false}></Video>`,
    oxcOptions: [
      {
        audio: ["Audio"],
        video: ["Video"],
        track: ["Track"],
      },
    ],
  },
  {
    code: `<Audio muted={false}></Audio>`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          polymorphicPropName: "as",
          components: {
            Audio: "audio",
            Video: "video",
            Track: "track",
          },
        },
      },
    },
  },
  {
    code: `<Video muted={false}></Video>`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          polymorphicPropName: "as",
          components: {
            Audio: "audio",
            Video: "video",
            Track: "track",
          },
        },
      },
    },
  },
  { code: `<video />` },
  { code: `<audio>Foo</audio>` },
  { code: `<video>Foo</video>` },
  {
    code: `<Audio />`,
    oxcOptions: [
      {
        audio: ["Audio"],
        video: ["Video"],
        track: ["Track"],
      },
    ],
  },
  {
    code: `<Video />`,
    oxcOptions: [
      {
        audio: ["Audio"],
        video: ["Video"],
        track: ["Track"],
      },
    ],
  },
  {
    code: `<Audio />`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          polymorphicPropName: "as",
          components: {
            Audio: "audio",
            Video: "video",
            Track: "track",
          },
        },
      },
    },
  },
  {
    code: `<Video />`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          polymorphicPropName: "as",
          components: {
            Audio: "audio",
            Video: "video",
            Track: "track",
          },
        },
      },
    },
  },
  {
    code: `<audio><Track /></audio>`,
    oxcOptions: [
      {
        audio: ["Audio"],
        video: ["Video"],
        track: ["Track"],
      },
    ],
  },
  {
    code: `<video><Track /></video>`,
    oxcOptions: [
      {
        audio: ["Audio"],
        video: ["Video"],
        track: ["Track"],
      },
    ],
  },
  {
    code: `<Audio><Track kind='subtitles' /></Audio>`,
    oxcOptions: [
      {
        audio: ["Audio"],
        video: ["Video"],
        track: ["Track"],
      },
    ],
  },
  {
    code: `<Video><Track kind='subtitles' /></Video>`,
    oxcOptions: [
      {
        audio: ["Audio"],
        video: ["Video"],
        track: ["Track"],
      },
    ],
  },
  {
    code: `<Audio><Track kind='subtitles' /></Audio>`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          polymorphicPropName: "as",
          components: {
            Audio: "audio",
            Video: "video",
            Track: "track",
          },
        },
      },
    },
  },
  {
    code: `<Video><Track kind='subtitles' /></Video>`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          polymorphicPropName: "as",
          components: {
            Audio: "audio",
            Video: "video",
            Track: "track",
          },
        },
      },
    },
  },
  {
    code: `<Box as='audio'><Track kind='subtitles' /></Box>`,
    oxcSettings: {
      settings: {
        "jsx-a11y": {
          polymorphicPropName: "as",
          components: {
            Audio: "audio",
            Video: "video",
            Track: "track",
          },
        },
      },
    },
  },
  { code: `<audio src="talk.mp3" controls />` },
  { code: `<video src="movie.mp4" controls />` },
];
