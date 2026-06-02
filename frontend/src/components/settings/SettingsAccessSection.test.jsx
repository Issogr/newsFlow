import { render, screen } from '@testing-library/react';
import SettingsAccessSection from './SettingsAccessSection';
import { createTranslator } from '../../i18n';

describe('SettingsAccessSection', () => {
  const t = createTranslator('en');
  const baseProps = {
    t,
    saving: false,
    importInputRef: { current: null },
    apiToken: null,
    newApiToken: '',
    settingsLimits: { apiTokenTtlDays: 30 },
    onExport: vi.fn(),
    onImportClick: vi.fn(),
    onImport: vi.fn(),
    onCreateApiToken: vi.fn(),
    onRevokeApiToken: vi.fn()
  };

  test('hides API token controls when authenticated public API is disabled', () => {
    render(<SettingsAccessSection {...baseProps} showApiTokenControls={false} />);

    expect(screen.queryByText('External API token')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate token' })).not.toBeInTheDocument();
    expect(screen.getByText('Legal documents')).toBeInTheDocument();
  });

  test('shows API token controls when authenticated public API is enabled', () => {
    render(<SettingsAccessSection {...baseProps} showApiTokenControls />);

    expect(screen.getByText('External API token')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate token' })).toBeInTheDocument();
  });
});
