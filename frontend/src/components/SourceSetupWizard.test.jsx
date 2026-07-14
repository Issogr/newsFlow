import { fireEvent, render, screen } from '@testing-library/react';
import SourceSetupWizard from './SourceSetupWizard';
import { createTranslator } from '../i18n';

vi.mock('../services/api', () => ({
  updateUserSettings: vi.fn()
}));

describe('SourceSetupWizard', () => {
  const t = createTranslator('en');
  const sourceCatalog = [
    {
      id: 'source-a',
      name: 'Source A',
      language: 'en',
      iconUrl: '',
      subSources: []
    },
    {
      id: 'source-b',
      name: 'Source B',
      language: 'it',
      iconUrl: '',
      subSources: []
    }
  ];

  const groupedSourceCatalog = [
    {
      id: 'source-group',
      name: 'Source Group',
      language: 'en',
      iconUrl: '',
      subSources: [
        { id: 'source-group-main', name: 'Main Feed', language: 'en' },
        { id: 'source-group-extra', name: 'Extra Feed', language: 'en' }
      ]
    },
    ...sourceCatalog
  ];

  test('selects sources when the catalog arrives after initial render', () => {
    const { rerender } = render(
      <SourceSetupWizard
        t={t}
        sources={[]}
        currentSettings={{}}
        onComplete={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Start reading' })).toBeDisabled();

    rerender(
      <SourceSetupWizard
        t={t}
        sources={sourceCatalog}
        currentSettings={{}}
        onComplete={vi.fn()}
      />
    );

    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start reading' })).toBeEnabled();
    const dialog = screen.getByRole('dialog', { name: 'Choose your news sources' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: 'Choose your news sources' })).toHaveFocus();

    fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }));
    expect(dialog).toBeInTheDocument();
  });

  test('preserves existing source review selections from saved exclusions', () => {
    render(
      <SourceSetupWizard
        t={t}
        sources={groupedSourceCatalog}
        currentSettings={{
          sourceSetupCompleted: false,
          excludedSourceIds: ['source-b'],
          excludedSubSourceIds: ['source-group-extra']
        }}
        onComplete={vi.fn()}
      />
    );

    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start reading' })).toBeEnabled();
  });
});
