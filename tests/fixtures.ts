// Trimmed copies of real YouTube data structures observed on 2026-09-28 (tracking params shortened).

export const MADE_WITH_AI_SECTION = {
  sectionTitle: { content: 'How this was made' },
  bodyText: {
    content: 'Sounds or visuals were altered or fully generated. Learn more',
    commandRuns: [
      {
        startIndex: 51,
        length: 10,
        onTap: {
          innertubeCommand: {
            commandMetadata: { webCommandMetadata: { url: '//support.google.com/youtube/answer/15447836?hl=en' } },
            urlEndpoint: { url: '//support.google.com/youtube/answer/15447836?hl=en', target: 'TARGET_NEW_WINDOW' },
          },
        },
      },
    ],
  },
  bodyHeader: { content: 'Made with AI' },
  attributionText: {},
};

export const AUTO_DUBBED_SECTION = {
  sectionTitle: { content: 'How this was made' },
  bodyText: {
    content: 'Audio tracks for some languages were automatically generated. Learn more',
    commandRuns: [{ onTap: { innertubeCommand: { urlEndpoint: { url: '//support.google.com/youtube/answer/15569972?hl=en' } } } }],
  },
  bodyHeader: { content: 'Auto-dubbed' },
};

export const watchResponse = (...sections: object[]) => ({
  contents: { twoColumnWatchNextResults: {} },
  engagementPanels: [
    { engagementPanelSectionListRenderer: { content: { sectionListRenderer: {} } } },
    {
      engagementPanelSectionListRenderer: {
        content: {
          structuredDescriptionContentRenderer: {
            items: [
              { videoDescriptionHeaderRenderer: { title: { runs: [{ text: 'Made with AI? No! Real band' }] } } },
              { expandableVideoDescriptionBodyRenderer: { descriptionBodyText: { content: 'This song was made with AI tools... not' } } },
              ...sections.map((s) => ({ howThisWasMadeSectionViewModel: s })),
            ],
          },
        },
      },
    },
  ],
});

/** ytd-video-renderer.data on search results. */
export const SEARCH_VIDEO_DATA = {
  videoId: 'JsBZOcqZerk',
  title: { runs: [{ text: 'The Insane Real Engineering of the Nazi Enigma Machine' }] },
  ownerText: {
    runs: [
      {
        text: 'Veritasium',
        navigationEndpoint: { browseEndpoint: { browseId: 'UCHnyfMqiRRG1u-2MsSQLbXA', canonicalBaseUrl: '/@veritasium' } },
      },
    ],
  },
  longBylineText: { runs: [{ text: 'Veritasium' }] },
};

/** yt-lockup-view-model.rawProps.data() on home / watch sidebar. */
export const LOCKUP_DATA = {
  contentId: 'onr80iOoEXs',
  contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
  contentImage: { thumbnailViewModel: {} },
  metadata: {
    lockupMetadataViewModel: {
      title: { content: 'Some video' },
      image: {
        decoratedAvatarViewModel: {
          a11yLabel: 'Go to channel Veritasium',
          rendererContext: {
            commandContext: {
              onTap: {
                innertubeCommand: {
                  clickTrackingParams: 'CIkCENTEDBgAIhMIvseDh4KRlwMVKdEbAB3XADt9ygEE_hCEnA==',
                  browseEndpoint: { browseId: 'UCHnyfMqiRRG1u-2MsSQLbXA', canonicalBaseUrl: '/@veritasium' },
                },
              },
            },
          },
        },
      },
    },
  },
};

/** A Shorts-shelf item: only a video ID, plus a tracking param that happens to contain "UC" + 22 chars. */
export const SHORTS_SHELF_ITEM = {
  shortsLockupViewModel: {
    entityId: 'shorts-shelf-item-ZDB05cTiDUg',
    onTap: {
      innertubeCommand: {
        clickTrackingParams: 'CJ0DEIf2BBgAIhMIg_CDmIKRlwMVWiSDAx3YLBTCUhJhaSBnZW5lcmF0ZWQgbXVzaWOaAQUIMhD0JMoBBP4QhJw=',
        params: 'xxUChgCIhMIg_CDmIKRlwMVWiSxx',
        reelWatchEndpoint: { videoId: 'ZDB05cTiDUg' },
      },
    },
  },
};
