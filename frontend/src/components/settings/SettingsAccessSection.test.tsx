import { fireEvent, render, screen } from '@testing-library/react';
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
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cookie Policy' })).toBeInTheDocument();
  });

  test('keeps API token controls inside the collapsed advanced section', () => {
    render(<SettingsAccessSection {...baseProps} showApiTokenControls />);

    const advanced = screen.getByText('Advanced').closest('details');
    expect(advanced).not.toHaveAttribute('open');

    fireEvent.click(screen.getByText('Advanced'));

    expect(advanced).toHaveAttribute('open');
    expect(screen.getByText('External API token')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate token' })).toBeInTheDocument();
  });
});
