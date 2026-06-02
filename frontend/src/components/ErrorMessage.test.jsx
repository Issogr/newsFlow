import { render, screen } from '@testing-library/react';
import ErrorMessage from './ErrorMessage';
import { createTranslator } from '../i18n';

describe('ErrorMessage', () => {
  const t = createTranslator('it');

  test('renders localized timeout errors from the API client code', () => {
    render(<ErrorMessage error={{ newsFlowClientCode: 'timeout' }} t={t} />);

    expect(screen.getByText('La richiesta ha impiegato troppo tempo. Riprova tra qualche secondo.')).toBeInTheDocument();
  });

  test('renders localized network errors from the API client code', () => {
    render(<ErrorMessage error={{ newsFlowClientCode: 'network' }} t={t} />);

    expect(screen.getByText('Impossibile connettersi al server. Verifica la tua connessione internet.')).toBeInTheDocument();
  });
});
