import fs from 'fs';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';

async function test() {
  try {
    const url = 'https://gutendex.com/books/84';
    const resMetadata = await fetch(url);
    const metadata = await resMetadata.json();
    const epubUrl = metadata.formats['application/epub+zip'];
    
    console.log("EPUB URL:", epubUrl);
    // use a public CORS proxy that allows node fetch or just direct fetch
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(epubUrl)}`;
    console.log("Fetching", proxyUrl);
    
    const res = await fetch(proxyUrl);
    const arrayBuffer = await res.arrayBuffer();
    
    console.log("Loading zip. Buffer size:", arrayBuffer.byteLength);
    const zip = await JSZip.loadAsync(arrayBuffer);
    
    const containerFile = zip.file("META-INF/container.xml");
    if (!containerFile) throw new Error("No container.xml");
    const containerXml = await containerFile.async("string");
    
    const dom = new JSDOM("");
    const parser = new dom.window.DOMParser();
    
    const containerDoc = parser.parseFromString(containerXml, "application/xml");
    const rootfile = Array.from(containerDoc.getElementsByTagName("*")).find(el => el.localName === "rootfile");
    const opfPath = rootfile.getAttribute("full-path");
    
    console.log("OPF Path:", opfPath);
    
    const opfBaseDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
    
    const opfFile = zip.file(opfPath);
    if (!opfFile) throw new Error("OPF not found");
    const opfXml = await opfFile.async("string");
    const opfDoc = parser.parseFromString(opfXml, "application/xml");
    
    const manifest = {};
    const items = Array.from(opfDoc.getElementsByTagName("*")).filter(el => el.localName === "item");
    for (let i = 0; i < items.length; i++) {
      manifest[items[i].getAttribute("id")] = items[i].getAttribute("href");
    }
    
    const itemrefs = Array.from(opfDoc.getElementsByTagName("*")).filter(el => el.localName === "itemref");
    const spineIds = itemrefs.map(itemref => itemref.getAttribute("idref"));
    
    console.log("Spine IDs length:", spineIds.length);
    
    let successCount = 0;
    for (const id of spineIds) {
      const href = manifest[id];
      const fullPath = opfBaseDir + decodeURIComponent(href);
      const chapterFile = zip.file(fullPath);
      if (chapterFile) {
        successCount++;
      } else {
        console.log("FAILED to find:", fullPath, "from href:", href);
      }
    }
    console.log("Successfully found", successCount, "out of", spineIds.length, "chapters");
    
  } catch (err) {
    console.error(err);
  }
}

test();
