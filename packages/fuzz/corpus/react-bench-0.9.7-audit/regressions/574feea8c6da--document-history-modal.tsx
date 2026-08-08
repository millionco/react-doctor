// rule: effect-needs-cleanup
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 574feea8c6da69c408c50ebc47342f8b551cd4211ceb06d08ac2e8e141348892
import { Dialog, DialogContent, DialogTitle } from '@mui/material';
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Y from 'yjs';

import { CollabVersionRecord } from '@/application/collab-version.type';
import { Types, ViewIcon } from '@/application/types';
import ComponentLoading from '@/components/_shared/progress/ComponentLoading';
import {
  useAppOperations,
  useCollabHistory,
  useGetSubscriptions,
  useCurrentWorkspaceId,
  useEventEmitter,
  useGetMentionUser,
  useLoadDatabaseRelations,
} from '@/components/app/app.hooks';
import { useSubscriptionPlan } from '@/components/app/hooks/useSubscriptionPlan';
import { Editor } from '@/components/editor';
import { EditorContextState } from '@/components/editor/EditorContext';
import { useCurrentUser } from '@/components/main/app.hooks';
import { cn } from '@/lib/utils';
import { Log } from '@/utils/log';

import { VersionList } from './DocumentHistoryVersionList';

type PreviewEditorProps = Pick<
  EditorContextState,
  | 'loadView'
  | 'bindViewSync'
  | 'loadViewMeta'
  | 'createRow'
  | 'eventEmitter'
  | 'getMentionUser'
  | 'getViewIdFromDatabaseId'
  | 'loadDatabaseRelations'
>;

type VersionPreviewBodyProps = {
  loading: boolean;
  error: string | null;
  activeDoc: Y.Doc | null;
  workspaceId?: string;
  viewId: string;
  /** Remount the editor when the previewed version changes so local editor state cannot leak across snapshots. */
  previewKey: string;
} & PreviewEditorProps;

const VersionPreviewBody = memo(function VersionPreviewBody({
  loading,
  error,
  activeDoc,
  workspaceId,
  viewId,
  previewKey,
  ...editorProps
}: VersionPreviewBodyProps) {
  if (loading) {
    return <ComponentLoading />;
  }

  if (error) {
    return <EmptyState message={error} />;
  }

  if (!activeDoc) {
    // Selected version is still fetching (or filters cleared the selection). Keep the
    // pane stable with a spinner rather than flashing an empty panel.
    return previewKey ? <ComponentLoading /> : null;
  }

  return (
    <div className='appflowy-scroller h-full overflow-y-auto overflow-x-hidden'>
      <Editor
        key={previewKey}
        workspaceId={workspaceId || ''}
        viewId={viewId}
        readOnly
        doc={activeDoc}
        fullWidth
        {...editorProps}
        uploadFile={undefined}
      />
    </div>
  );
});

// Static, so hoist it out of render: avoids recreating the object (and re-running
// `cn`) on every render and handing MUI's Dialog a fresh `PaperProps` each time.
const DIALOG_PAPER_PROPS = {
  className: cn(
    'flex !h-full !w-full overflow-hidden rounded-2xl bg-surface-layer-02',
    '!max-h-[min(920px,_calc(100vh-160px))] !min-h-[min(689px,_calc(100vh-40px))] !min-w-[min(984px,_calc(100vw-40px))] !max-w-[min(1680px,_calc(100vw-240px))]'
  ),
};

export function DocumentHistoryModal({
  open,
  onOpenChange,
  viewId,
  view,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  viewId: string;
  view?: {
    name: string;
    icon: ViewIcon | null;
  };
}) {
  const { loadViewMeta, createRow, getViewIdFromDatabaseId, loadView, bindViewSync } = useAppOperations();
  const { getCollabHistory, previewCollabVersion, revertCollabVersion } = useCollabHistory();
  const getSubscriptions = useGetSubscriptions();
  const eventEmitter = useEventEmitter();
  const getMentionUser = useGetMentionUser();
  const loadDatabaseRelations = useLoadDatabaseRelations();
  const workspaceId = useCurrentWorkspaceId();
  const currentUser = useCurrentUser();
  const { isPro } = useSubscriptionPlan(getSubscriptions);
  const { t } = useTranslation();
  const titleId = useId();
  const [versions, setVersions] = useState<CollabVersionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');
  const [dateFilter, setDateFilter] = useState<'all' | 'last7Days' | 'last30Days' | 'last60Days'>('all');
  const [onlyShowMine, setOnlyShowMine] = useState(false);
  const previewYDocRef = useRef<Map<string, Y.Doc>>(new Map());
  const [activeDoc, setActiveDoc] = useState<Y.Doc | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const selectedVersionIdRef = useRef(selectedVersionId);
  const activeViewIdRef = useRef(viewId);
  const versionsRef = useRef(versions);
  // viewId whose history currently sits in `versions`. Cleared synchronously on
  // reset so the preview effect cannot pair a new viewId with a stale selection
  // before React applies the reset setStates.
  const loadedHistoryViewIdRef = useRef<string | null>(null);

  selectedVersionIdRef.current = selectedVersionId;
  activeViewIdRef.current = viewId;
  versionsRef.current = versions;

  const visibleVersions = useMemo(() => {
    let filtered = [...versions];

    if (onlyShowMine && currentUser) {
      filtered = filtered.filter((version) => version.editors.some((editor) => editor.toString() === currentUser.uid));
    }

    const now = new Date();

    filtered = filtered.filter((version) => {
      if (dateFilter === 'all') {
        return true;
      }

      const diffTime = Math.abs(now.getTime() - version.createdAt.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (dateFilter === 'last7Days') {
        return diffDays <= 7;
      } else if (dateFilter === 'last30Days') {
        return diffDays <= 30;
      } else if (dateFilter === 'last60Days') {
        return diffDays <= 60;
      }

      return true;
    });

    return filtered;
  }, [versions, onlyShowMine, currentUser, dateFilter]);

  const refreshVersions = useCallback(async () => {
    if (!viewId || !getCollabHistory) {
      return [];
    }

    const requestViewId = viewId;

    setLoading(true);
    setError(null);
    try {
      const data = await getCollabHistory(requestViewId);

      if (activeViewIdRef.current !== requestViewId) {
        return [];
      }

      const activeVersions = data.filter((version) => !version.deletedAt);

      loadedHistoryViewIdRef.current = requestViewId;
      setVersions(activeVersions);
      return activeVersions;
    } catch (error) {
      if (activeViewIdRef.current !== requestViewId) {
        return [];
      }

      setError(error instanceof Error ? error.message : String(error));
      return [];
    } finally {
      if (activeViewIdRef.current === requestViewId) {
        setLoading(false);
      }
    }
  }, [viewId, getCollabHistory]);

  // Detach the cache map immediately, but destroy Y.Docs on the next macrotask so
  // React can commit `activeDoc = null` / unmount the preview Editor first.
  // Destroying synchronously in an effect races MUI's Dialog exit transition
  // (keepMounted={false} still keeps children mounted until onExited).
  const clearPreviewDocs = useCallback(() => {
    const pending = Array.from(previewYDocRef.current.values());

    previewYDocRef.current.clear();
    if (pending.length === 0) {
      return;
    }

    setTimeout(() => {
      pending.forEach((doc) => {
        doc.destroy();
      });
    }, 0);
  }, []);

  const handleRestore = useCallback(async () => {
    const versionId = selectedVersionIdRef.current;

    if (!viewId || !versionId || !revertCollabVersion) {
      return;
    }

    setIsRestoring(true);
    setError(null);
    try {
      const versionRecord = versionsRef.current.find((v) => v.versionId === versionId);

      Log.debug('[Version] Reverting document to version', { viewId, versionId, createdAt: versionRecord?.createdAt });
      await revertCollabVersion(viewId, versionId);
      Log.debug('[Version] Document reverted to version', { viewId, versionId, createdAt: versionRecord?.createdAt });

      // Wait for the server to broadcast the reverted state over WebSocket before
      // closing the dialog. Without this, replayQueuedMessages() inside
      // revertCollabVersion may have re-applied in-flight messages that overwrite
      // the revert; the network round-trip here gives the sync layer time to
      // re-deliver the correct state so the editor shows reverted content on close.
      await refreshVersions();

      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      Log.error('Failed to restore document version', err);
      setError(message);
    } finally {
      setIsRestoring(false);
    }
  }, [viewId, revertCollabVersion, refreshVersions, onOpenChange]);

  const handleClose = useCallback(() => onOpenChange(false), [onOpenChange]);

  // Reset before fetch/preview effects below so a viewId/open change cannot start
  // a request against leftover selection/cache from the previous document.
  useEffect(() => {
    loadedHistoryViewIdRef.current = null;
    setVersions([]);
    setSelectedVersionId('');
    setError(null);
    setLoading(open);
    setActiveDoc(null);
    clearPreviewDocs();
  }, [viewId, open, clearPreviewDocs]);

  useEffect(() => {
    if (!open) {
      return;
    }

    void refreshVersions();
  }, [open, refreshVersions]);

  useEffect(() => {
    if (visibleVersions.length === 0) {
      if (selectedVersionIdRef.current) {
        setSelectedVersionId('');
      }

      return;
    }

    if (!visibleVersions.some((v) => v.versionId === selectedVersionIdRef.current)) {
      setSelectedVersionId(visibleVersions[0].versionId);
    }
  }, [visibleVersions]);

  useEffect(() => {
    if (!open) {
      setActiveDoc(null);
      clearPreviewDocs();
      return;
    }

    if (!selectedVersionId || !viewId || !previewCollabVersion) {
      setActiveDoc(null);
      return;
    }

    // Reset clears this ref synchronously; until refreshVersions finishes for the
    // current view, skip so we never preview (newViewId, oldVersionId).
    if (loadedHistoryViewIdRef.current !== viewId) {
      setActiveDoc(null);
      return;
    }

    let cancelled = false;
    const previewVersionId = selectedVersionId;
    const previewViewId = viewId;
    const cachedDoc = previewYDocRef.current.get(previewVersionId);

    if (cachedDoc) {
      setError(null);
      setActiveDoc(cachedDoc);
      return;
    }

    // Drop the previous snapshot immediately so we never show version A while
    // version B is still loading. Also clear a prior preview error so the pane
    // can show a loading state for the new selection.
    setActiveDoc(null);
    setError(null);

    void (async () => {
      try {
        const doc = await previewCollabVersion(previewViewId, previewVersionId, Types.Document);

        if (
          cancelled ||
          activeViewIdRef.current !== previewViewId ||
          loadedHistoryViewIdRef.current !== previewViewId
        ) {
          doc?.destroy();
          return;
        }

        if (!doc) {
          setActiveDoc(null);
          setError('No document state returned');
          return;
        }

        previewYDocRef.current.set(previewVersionId, doc);
        setError(null);
        setActiveDoc(doc);
      } catch (error) {
        if (
          cancelled ||
          activeViewIdRef.current !== previewViewId ||
          loadedHistoryViewIdRef.current !== previewViewId
        ) {
          return;
        }

        Log.warn('Failed to preview document version', error);
        setActiveDoc(null);
        setError(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, previewCollabVersion, selectedVersionId, viewId, clearPreviewDocs]);

  useEffect(() => {
    return () => {
      clearPreviewDocs();
    };
  }, [clearPreviewDocs]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      aria-labelledby={titleId}
      fullWidth
      maxWidth={false}
      keepMounted={false}
      disableAutoFocus={false}
      disableEnforceFocus={false}
      disableRestoreFocus
      PaperProps={DIALOG_PAPER_PROPS}
    >
      <DialogContent data-testid='version-history-modal' className='flex h-full w-full overflow-hidden p-0'>
        <div className='order-2 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-t-2xl md:order-1 md:rounded-l-2xl md:rounded-tr-none'>
          <DialogTitle id={titleId} className='border-b border-border px-6 py-4 text-base font-bold text-text-primary'>
            {view?.name || t('untitled')}
          </DialogTitle>
          <div className='min-h-0 flex-1 overflow-hidden'>
            <VersionPreviewBody
              loading={loading}
              error={error}
              activeDoc={activeDoc}
              workspaceId={workspaceId}
              viewId={viewId}
              previewKey={selectedVersionId}
              loadView={loadView}
              bindViewSync={bindViewSync}
              loadViewMeta={loadViewMeta}
              createRow={createRow}
              eventEmitter={eventEmitter}
              getMentionUser={getMentionUser}
              getViewIdFromDatabaseId={getViewIdFromDatabaseId}
              loadDatabaseRelations={loadDatabaseRelations}
            />
          </div>
        </div>
        <div className='order-1 flex w-full max-w-full flex-col rounded-r-2xl border-border-primary bg-surface-container-layer-01 md:order-2 md:w-[280px] md:border-l'>
          <VersionList
            versions={visibleVersions}
            selectedVersionId={selectedVersionId}
            onSelect={setSelectedVersionId}
            dateFilter={dateFilter}
            onlyShowMine={onlyShowMine}
            onDateFilterChange={setDateFilter}
            onOnlyShowMineChange={setOnlyShowMine}
            onRestoreClicked={handleRestore}
            isRestoring={isRestoring}
            onClose={handleClose}
            isPro={isPro}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({ message }: { message: string }) {
  return <div className='flex h-full items-center justify-center text-sm text-text-tertiary'>{message}</div>;
}

export default DocumentHistoryModal;
