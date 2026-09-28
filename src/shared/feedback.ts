/**
 * YouTube's own "Don't recommend channel" action, as found in a tile's ⋮ menu data. Pure.
 *
 * Verified 2026-09-28 on a signed-in home feed (French UI), docs/YOUTUBE-DOM.md §6:
 *
 *   yt-lockup-view-model rawProps.data()
 *     .metadata.lockupMetadataViewModel.menuButton.buttonViewModel.onTap.innertubeCommand
 *     .showSheetCommand.panelLoadingStrategy.inlineContent.sheetViewModel.content.listViewModel.listItems[i]
 *       .listItemViewModel {
 *          title: { content: "Ne pas recommander la chaîne" },          // localized
 *          leadingImage: { sources: [{ clientResource: { imageName: "REMOVE" } }] },   // language independent
 *          rendererContext.commandContext.onTap.innertubeCommand.feedbackEndpoint { feedbackToken, … undo … }
 *       }
 *
 * "Not interested" (in the video, not the channel) is the neighbouring item with imageName "HIDE" — never that one.
 * The item only exists for signed-in users, mostly on home / recommendation feeds.
 */

type Obj = Record<string, any>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object';

export interface DontRecommendItem {
  /** The item's label exactly as YouTube renders it (localized) — used to find it in the opened menu. */
  title: string;
}

export function findDontRecommendItem(root: unknown, maxNodes = 5000): DontRecommendItem | null {
  const stack: unknown[] = [root];
  let seen = 0;
  while (stack.length && seen++ < maxNodes) {
    const node = stack.pop();
    if (!isObj(node)) continue;

    // New view-model menus (yt-lockup-view-model).
    const lvm = node.listItemViewModel;
    if (isObj(lvm)) {
      const title = lvm.title?.content;
      const icon = lvm.leadingImage?.sources?.[0]?.clientResource?.imageName;
      const token = lvm.rendererContext?.commandContext?.onTap?.innertubeCommand?.feedbackEndpoint?.feedbackToken;
      if (icon === 'REMOVE' && typeof title === 'string' && title && typeof token === 'string') return { title };
    }

    // Classic Polymer menus (ytd-menu-renderer).
    const msi = node.menuServiceItemRenderer;
    if (isObj(msi)) {
      const title = msi.text?.runs?.map((r: Obj) => r.text).join('') ?? msi.text?.simpleText;
      const token = msi.serviceEndpoint?.feedbackEndpoint?.feedbackToken;
      if (msi.icon?.iconType === 'REMOVE' && typeof title === 'string' && title && typeof token === 'string') return { title };
    }

    for (const v of Array.isArray(node) ? node : Object.values(node)) if (isObj(v)) stack.push(v);
  }
  return null;
}
