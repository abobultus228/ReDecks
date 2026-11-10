import { createContext } from 'react';

export const NavigationMenuContext = createContext<(() => void) | null>(null);
