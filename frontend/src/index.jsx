import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider, useAuth, useClerk, useUser } from '@clerk/clerk-react';
import './index.css';
import App from './App';

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '';

const disabledClerkAuth = {
  enabled: false,
  isLoaded: true,
  isSignedIn: false,
  getToken: async () => '',
  completeGoogleSignInRedirect: async () => {},
  startGoogleSignIn: async () => {},
  signOut: async () => {},
  user: null
};

function ClerkAppShell() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const clerk = useClerk();
  const { user } = useUser();

  const startGoogleSignIn = async () => {
    const signIn = clerk.client?.signIn;
    if (!signIn) {
      throw new Error('Clerk sign-in is not ready yet');
    }

    const currentUrl = window.location.href;
    const callbackUrl = new URL('/auth/google/callback', window.location.origin).toString();
    await signIn.authenticateWithRedirect({
      strategy: 'oauth_google',
      redirectUrl: callbackUrl,
      redirectUrlComplete: currentUrl
    });
  };

  const completeGoogleSignInRedirect = async () => {
    let redirectTarget = '/';

    await clerk.handleRedirectCallback({}, async (to) => {
      redirectTarget = to || '/';
      return Promise.resolve();
    });

    return redirectTarget;
  };

  return (
    <App
      clerkAuth={{
        enabled: true,
        isLoaded,
        isSignedIn: Boolean(isSignedIn),
        completeGoogleSignInRedirect,
        getToken,
        startGoogleSignIn,
        signOut: clerk.signOut,
        user
      }}
    />
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    {clerkPublishableKey ? (
      <ClerkProvider publishableKey={clerkPublishableKey}>
        <ClerkAppShell />
      </ClerkProvider>
    ) : (
      <App clerkAuth={disabledClerkAuth} />
    )}
  </React.StrictMode>
);
