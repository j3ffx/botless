import { describe, expect, it } from 'vitest';
import { findDontRecommendItem } from '../src/shared/feedback';

/** A ⋮ menu item as found in a signed-in home feed lockup (tokens shortened). */
const item = (title: string, icon: string, feedback = true) => ({
  listItemViewModel: {
    title: { content: title },
    leadingImage: { sources: [{ clientResource: { imageName: icon } }] },
    rendererContext: {
      commandContext: {
        onTap: {
          innertubeCommand: feedback
            ? { commandMetadata: { webCommandMetadata: { sendPost: true, apiUrl: '/youtubei/v1/feedback' } }, feedbackEndpoint: { feedbackToken: 'AB9zfpIrgI-f', uiActions: { hideEnclosingContainer: true } } }
            : { shareEntityServiceEndpoint: {} },
        },
      },
    },
  },
});

const lockup = (...items: object[]) => ({
  contentId: 'zr8xc870_2o',
  metadata: {
    lockupMetadataViewModel: {
      menuButton: {
        buttonViewModel: {
          onTap: {
            innertubeCommand: {
              showSheetCommand: {
                panelLoadingStrategy: { inlineContent: { sheetViewModel: { content: { listViewModel: { listItems: items } } } } },
              },
            },
          },
        },
      },
    },
  },
});

describe('findDontRecommendItem', () => {
  it('finds "Don\'t recommend channel" by its REMOVE icon, whatever the language', () => {
    const data = lockup(
      item('Partager', 'SHARE', false),
      item('Pas intéressé', 'HIDE'),
      item('Ne pas recommander la chaîne', 'REMOVE'),
      item('Signaler', 'FLAG', false),
    );
    expect(findDontRecommendItem(data)).toEqual({ title: 'Ne pas recommander la chaîne' });
  });

  it('never picks "Not interested" (HIDE) and needs a real feedback action', () => {
    expect(findDontRecommendItem(lockup(item('Pas intéressé', 'HIDE')))).toBeNull();
    expect(findDontRecommendItem(lockup(item('Ne pas recommander la chaîne', 'REMOVE', false)))).toBeNull();
  });

  it('is absent when signed out (menu has no feedback items)', () => {
    expect(findDontRecommendItem(lockup(item('Add to queue', 'ADD_TO_QUEUE_TAIL', false), item('Share', 'SHARE', false)))).toBeNull();
    expect(findDontRecommendItem(undefined)).toBeNull();
  });

  it('supports classic Polymer menus', () => {
    const classic = {
      menu: {
        menuRenderer: {
          items: [
            { menuServiceItemRenderer: { text: { runs: [{ text: "Don't recommend channel" }] }, icon: { iconType: 'REMOVE' }, serviceEndpoint: { feedbackEndpoint: { feedbackToken: 'x' } } } },
          ],
        },
      },
    };
    expect(findDontRecommendItem(classic)).toEqual({ title: "Don't recommend channel" });
  });
});
