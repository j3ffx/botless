/**
 * YouTube's own feedback actions, as found in a tile's ⋮ menu data. Pure.
 *
 * Verified 2026-09-28 on a signed-in home feed (French UI), docs/YOUTUBE-DOM.md §6:
 *
 *   Video tiles (yt-lockup-view-model) rawProps.data()
 *     .metadata.lockupMetadataViewModel.menuButton.buttonViewModel.onTap.innertubeCommand
 *     .showSheetCommand.panelLoadingStrategy.inlineContent.sheetViewModel.content.listViewModel.listItems[i]
 *   Shorts tiles (ytm-shorts-lockup-view-model-v2) rawProps.menuOnTap… (same listItemViewModel shape)
 *
 *   listItemViewModel {
 *     title: { content: "Ne pas recommander la chaîne" },                           // localized
 *     leadingImage: { sources: [{ clientResource: { imageName: "REMOVE" } }] },     // language independent
 *     rendererContext.commandContext.onTap.innertubeCommand.feedbackEndpoint { feedbackToken, … undo … }
 *   }
 *
 *   imageName "REMOVE" = "Don't recommend channel" (video tiles only)
 *   imageName "HIDE"   = "Not interested" (this video only; the only option on Shorts tiles)
 *
 * Both only exist for signed-in users, mostly on home / recommendation feeds.
 */

type Obj = Record<string, any>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object';

/** 'channel' = Don't recommend channel (REMOVE); 'video' = Not interested (HIDE). */
export type FeedbackKind = 'channel' | 'video';
const ICON: Record<FeedbackKind, string> = { channel: 'REMOVE', video: 'HIDE' };

export interface FeedbackItem {
  /** The item's label exactly as YouTube renders it (localized) — used to find it in the opened menu. */
  title: string;
}

export function findFeedbackItem(root: unknown, kind: FeedbackKind, maxNodes = 5000): FeedbackItem | null {
  const icon = ICON[kind];
  const stack: unknown[] = [root];
  let seen = 0;
  while (stack.length && seen++ < maxNodes) {
    const node = stack.pop();
    if (!isObj(node)) continue;

    // New view-model menus (yt-lockup-view-model, Shorts lockups).
    const lvm = node.listItemViewModel;
    if (isObj(lvm)) {
      const title = lvm.title?.content;
      const token = lvm.rendererContext?.commandContext?.onTap?.innertubeCommand?.feedbackEndpoint?.feedbackToken;
      if (lvm.leadingImage?.sources?.[0]?.clientResource?.imageName === icon && typeof title === 'string' && title && typeof token === 'string') {
        return { title };
      }
    }

    // Classic Polymer menus (ytd-menu-renderer).
    const msi = node.menuServiceItemRenderer;
    if (isObj(msi)) {
      const title = msi.text?.runs?.map((r: Obj) => r.text).join('') ?? msi.text?.simpleText;
      const token = msi.serviceEndpoint?.feedbackEndpoint?.feedbackToken;
      if (msi.icon?.iconType === icon && typeof title === 'string' && title && typeof token === 'string') return { title };
    }

    for (const v of Array.isArray(node) ? node : Object.values(node)) if (isObj(v)) stack.push(v);
  }
  return null;
}

/** "Don't recommend channel" (video tiles). */
export const findDontRecommendItem = (root: unknown): FeedbackItem | null => findFeedbackItem(root, 'channel');
