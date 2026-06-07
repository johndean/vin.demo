'use client';
import { createContext, useContext } from 'react';
import { EMPTY_VD, type VDType } from './data';

const DataCtx = createContext<VDType>(EMPTY_VD);

export function DataProvider({ value, children }: { value: VDType; children: React.ReactNode }) {
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

/** The live console dataset (real DB data, provided by the server page). */
export function useData(): VDType {
  return useContext(DataCtx);
}
