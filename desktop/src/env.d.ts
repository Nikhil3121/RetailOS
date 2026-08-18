/// <reference types="vite/client" />

import type * as React from 'react';
import type { RetailOSApi } from '../electron/preload';

declare global {
  interface Window {
    /** Exposed by electron/preload.ts. `undefined` when running in a plain browser. */
    retailos?: RetailOSApi;
  }

  // React 19 no longer exposes a global JSX namespace by default.
  // Re-export from React.JSX so code written before the change still compiles.
  namespace JSX {
    type Element = React.JSX.Element;
    type ElementClass = React.JSX.ElementClass;
    type ElementAttributesProperty = React.JSX.ElementAttributesProperty;
    type ElementChildrenAttribute = React.JSX.ElementChildrenAttribute;
    type LibraryManagedAttributes<C, P> = React.JSX.LibraryManagedAttributes<C, P>;
    type IntrinsicAttributes = React.JSX.IntrinsicAttributes;
    type IntrinsicClassAttributes<T> = React.JSX.IntrinsicClassAttributes<T>;
    type IntrinsicElements = React.JSX.IntrinsicElements;
  }
}

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

export {};
