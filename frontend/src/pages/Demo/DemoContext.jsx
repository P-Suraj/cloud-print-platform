import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { getPdfDetails } from '../../services/pdfCounter';

const DemoContext = createContext();

const DEMO_FILES = {
  resume: {
    id: 'resume',
    name: 'Sample_Resume.pdf',
    type: 'pdf',
    pageCount: 3,
    thumbnail: 'https://images.unsplash.com/photo-1586281380349-632531db7ed4?q=80&w=300', // Resume-like document
  },
  photo: {
    id: 'photo',
    name: 'Sample_Photo.jpg',
    type: 'image',
    pageCount: 1,
    thumbnail: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?q=80&w=200', // Unsplash placeholder
  }
};

const BW_RATE = 2.0;
const COLOR_RATE = 5.0;

const initialState = {
  phase: 'idle', // idle, configuring, submitted, approving, completed
  file: null,
  usedDemoFile: false,
  isAadhaarMode: false,
  colorMode: 'bw', // bw, color
  copies: 1,
  duplex: false,
  layoutMode: 'document', // document, photo_grid
  gridSize: 4,
  gridImages: [],
  pageRange: '',
  paperSize: 'A4',
  orientation: 'auto',
  fitMode: 'fit',
  jobId: null,
  submittedAt: null,
  calculatedPrice: '0.00',
  timelineStep: 0, // 0 to 5
  aadhaarFront: null,
  aadhaarBack: null,
};

export function DemoProvider({ children }) {
  const [state, setState] = useState(initialState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExitModalOpen, setIsExitModalOpen] = useState(false);
  
  // Calculate price whenever options change
  useEffect(() => {
    if (state.isAadhaarMode) {
      const priceStr = (10.00 * state.copies).toFixed(2);
      if (state.calculatedPrice !== priceStr) {
        setState(s => ({ ...s, calculatedPrice: priceStr }));
      }
      return;
    }
    if (!state.file) {
      if (state.calculatedPrice !== '0.00') {
        setState(s => ({ ...s, calculatedPrice: '0.00' }));
      }
      return;
    }
    const rate = state.colorMode === 'color' ? COLOR_RATE : BW_RATE;
    const effectivePages = state.file.pageCount || 1;
    let total = effectivePages * state.copies * rate;
    if (state.duplex) {
      total = total * 0.9;
    }
    const priceStr = total.toFixed(2);
    if (state.calculatedPrice !== priceStr) {
      setState(s => ({ ...s, calculatedPrice: priceStr }));
    }
  }, [
    state.file, 
    state.isAadhaarMode,
    state.colorMode, 
    state.copies, 
    state.duplex, 
    state.layoutMode, 
    state.gridSize, 
    state.calculatedPrice
  ]);

  // Timeline auto-advance
  useEffect(() => {
    if (state.phase === 'approving' && state.timelineStep < 5) {
      const timer = setTimeout(() => {
        setState(s => ({ ...s, timelineStep: s.timelineStep + 1 }));
      }, 800);
      return () => clearTimeout(timer);
    } else if (state.phase === 'approving' && state.timelineStep === 5) {
      setState(s => ({ ...s, phase: 'completed' }));
    }
  }, [state.phase, state.timelineStep]);

  const selectDemoFile = useCallback(async (fileId) => {
    const file = DEMO_FILES[fileId];
    if (fileId === 'resume') {
      // 1. Immediately set processing state so loading spinner shows
      setState(s => ({
        ...s,
        file: { name: 'Sample_Resume.pdf', type: 'document', pageCount: 3, thumbnail: null, isProcessing: true },
        usedDemoFile: true,
        phase: 'configuring',
        layoutMode: 'document',
        colorMode: 'bw'
      }));
      try {
        // 2. Fetch the real PDF file from public directory
        const res = await fetch('/Sample_Resume.pdf');
        const blob = await res.blob();
        const rawFile = new File([blob], 'Sample_Resume.pdf', { type: 'application/pdf' });
        
        // 3. Extract page count and thumbnail dynamically
        const { pageCount, thumbnail } = await getPdfDetails(rawFile);
        setState(s => ({
          ...s,
          file: { name: 'Sample_Resume.pdf', type: 'document', pageCount, raw: rawFile, thumbnail, isProcessing: false }
        }));
      } catch (err) {
        console.error("Failed to load demo PDF:", err);
        // Fallback to static mock if fetch fails
        setState(s => ({
          ...s,
          file: { ...file, raw: null, isProcessing: false }
        }));
      }
    } else {
      const isImg = file.type === 'image';
      setState(s => ({
        ...s,
        file,
        usedDemoFile: true,
        phase: 'configuring',
        layoutMode: isImg ? 'photo_grid' : 'document',
        colorMode: isImg ? 'color' : 'bw',
        gridImages: isImg ? [file.thumbnail] : [],
        gridSize: 4
      }));
    }
  }, []);

  const setUploadedFile = useCallback((fileObj) => {
    const isImg = fileObj.type === 'image';
    setState(s => {
      const isSameFile = s.file && s.file.name === fileObj.name && s.file.raw === fileObj.raw;
      return {
        ...s,
        file: fileObj,
        phase: 'configuring',
        // Reset options if switching files, otherwise preserve settings
        layoutMode: isSameFile ? s.layoutMode : (isImg ? 'photo_grid' : 'document'),
        colorMode: isSameFile ? s.colorMode : (isImg ? 'color' : 'bw'),
        gridImages: isSameFile ? s.gridImages : (isImg ? [fileObj.thumbnail] : []),
        gridSize: isSameFile ? s.gridSize : 4
      };
    });
  }, []);

  const updateOption = useCallback((key, value) => {
    setState(s => ({ ...s, [key]: value }));
  }, []);

  const submitJob = useCallback(() => {
    setIsSubmitting(true);
    setTimeout(() => {
      setState(s => ({
        ...s,
        phase: 'submitted',
        jobId: 'A3F1',
        submittedAt: new Date(),
      }));
      setIsSubmitting(false);
    }, 300);
  }, []);

  const approveJob = useCallback(() => {
    setState(s => ({
      ...s,
      phase: 'approving',
      timelineStep: 3, // Start timeline animation at step 3 (Agent received) as steps 0-2 are instant
    }));
  }, []);

  const resetDemo = useCallback(() => {
    setState(initialState);
  }, []);

  const tryAadhaarMode = useCallback(() => {
    setState({
      ...initialState,
      isAadhaarMode: true,
      phase: 'configuring',
      calculatedPrice: '10.00', // Aadhaar prints cost 10.00 rupees
    });
  }, []);

  return (
    <DemoContext.Provider
      value={{
        state,
        isSubmitting,
        isExitModalOpen,
        setIsExitModalOpen,
        DEMO_FILES,
        selectDemoFile,
        setUploadedFile,
        updateOption,
        submitJob,
        approveJob,
        resetDemo,
        tryAadhaarMode
      }}
    >
      {children}
    </DemoContext.Provider>
  );
}

export const useDemo = () => useContext(DemoContext);
