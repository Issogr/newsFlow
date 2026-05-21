import React from 'react';
import { render, screen } from '@testing-library/react';
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
  });
});
