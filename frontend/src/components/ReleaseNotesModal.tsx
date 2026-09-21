import { Sparkles, X } from 'lucide-react';
import ProjectGitHubLink from './ProjectGitHubLink';
import ExternalPillLink from './ExternalPillLink';
import ModalDialog from './ModalDialog';
import type { RefObject } from 'react';
import type { ReleaseNotes, Translator } from '../types';

const ReleaseNotesModal = ({ t, releaseNotes, saving, onDismiss, restoreFocusRef }: { t: Translator; releaseNotes: ReleaseNotes; saving: boolean; onDismiss: () => void; restoreFocusRef?: RefObject<HTMLElement | null> }) => (
    <ModalDialog
      ariaLabelledBy="release-notes-title"
      className="fixed inset-0 z-[60] flex h-[100dvh] w-full items-stretch justify-center overflow-y-auto bg-slate-950/45 backdrop-blur-sm sm:items-center sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:pl-[calc(1rem+env(safe-area-inset-left))] sm:pr-[calc(1rem+env(safe-area-inset-right))] sm:pt-[calc(1.5rem+env(safe-area-inset-top))]"
      dismissOnEscape={!saving}
      onRequestClose={onDismiss}
      restoreFocusRef={restoreFocusRef}
    >
      <div className="flex min-h-full w-full max-w-xl flex-col overflow-hidden bg-white shadow-xl sm:min-h-0 sm:max-h-full sm:rounded-2xl sm:border sm:border-slate-200" data-modal-content>
        <div className="flex shrink-0 items-start justify-between border-b border-slate-200 pb-5 pl-[calc(1.5rem+env(safe-area-inset-left))] pr-[calc(1.5rem+env(safe-area-inset-right))] pt-[calc(1.25rem+env(safe-area-inset-top))] sm:px-6 sm:py-5">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-medium text-slate-500">
              <Sparkles className="h-4 w-4" />
              {releaseNotes.eyebrow}
            </p>
            <h2 id="release-notes-title" className="mt-2 text-xl font-semibold text-slate-900 focus:outline-none" data-modal-title tabIndex={-1}>{releaseNotes.title}</h2>
            <p className="mt-2 text-sm text-slate-500">{releaseNotes.intro}</p>
          </div>

          <button
            type="button"
            onClick={onDismiss}
            disabled={saving}
            className="ui-icon-button ml-3"
            aria-label={t('releaseNotesDismiss')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-1 flex-col items-start gap-5 overflow-y-auto py-6 pl-[calc(1.5rem+env(safe-area-inset-left))] pr-[calc(1.5rem+env(safe-area-inset-right))] sm:px-6">
          <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
            {releaseNotes.date ? <time dateTime={releaseNotes.date}>{releaseNotes.dateLabel}</time> : t('changelogUnreleased')}
          </span>

          <ExternalPillLink href={releaseNotes.url} target="_blank">
            {t('releaseNotesFullChangelog')}
          </ExternalPillLink>
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-slate-200 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pl-[calc(1.5rem+env(safe-area-inset-left))] pr-[calc(1.5rem+env(safe-area-inset-right))] pt-5 sm:px-6 sm:py-5">
          <ProjectGitHubLink />
          <button
            type="button"
            onClick={onDismiss}
            disabled={saving}
            className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? t('saving') : t('releaseNotesDismiss')}
          </button>
        </div>
      </div>
    </ModalDialog>
);

export default ReleaseNotesModal;
