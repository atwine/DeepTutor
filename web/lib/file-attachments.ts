"use client";

/**
 * Read a File as a data URL (base64-encoded).
 *
 * @param file - The file to read.
 * @returns A promise resolving to the data URL string.
 */
export async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Extract the base64 payload from a data URL.
 *
 * @param dataUrl - The data URL to strip.
 * @returns The base64 portion after the comma, or the input if no comma is present.
 */
export function extractBase64FromDataUrl(dataUrl: string): string {
  return dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
}
