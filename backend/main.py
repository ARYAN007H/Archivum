from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
import requests
import re

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def parse_gutenberg_text(text: str):
    # Strip start/end headers
    start_match = re.search(r'\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG EBOOK.*?\*\*\*', text, re.IGNORECASE)
    end_match = re.search(r'\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG EBOOK.*?\*\*\*', text, re.IGNORECASE)
    
    if start_match:
        text = text[start_match.end():]
    if end_match:
        text = text[:end_match.start()]
        
    text = text.strip()
    
    # Split by paragraphs (double newlines)
    blocks = re.split(r'\n\s*\n', text)
    
    chapters = []
    current_chapter = {"title": "Introduction", "paragraphs": []}
    
    for block in blocks:
        block = block.strip()
        if not block:
            continue
            
        # Try to detect if block is a chapter heading
        # A heading is usually short and often uppercase or starts with Chapter, Book, or Hindi equivalent
        is_heading = False
        lines = [l.strip() for l in block.split('\n') if l.strip()]
        if len(lines) <= 2 and len(block) < 120:
            first_line = lines[0]
            if (
                block.isupper() or 
                re.match(r'^(chapter|book|part|section|volume|story|act|scene|prologue|epilogue|अध्याय)\b', first_line, re.IGNORECASE) or
                re.match(r'^[IVXLCDM]+\b', first_line)
            ):
                is_heading = True
                
        if is_heading:
            if current_chapter["paragraphs"]:
                chapters.append(current_chapter)
            current_chapter = {"title": block.replace('\n', ' '), "paragraphs": []}
        else:
            # Unwrap paragraph (replace single newlines with space)
            para = re.sub(r'(?<!\n)\n(?!\n)', ' ', block)
            # Fix any multiple spaces
            para = re.sub(r'\s+', ' ', para).strip()
            
            # Format markdown italics/bolds to HTML
            para = re.sub(r'_([^_]+)_', r'<em>\1</em>', para)
            para = re.sub(r'\*([^*]+)\*', r'<strong>\1</strong>', para)
            
            current_chapter["paragraphs"].append(para)
            
    if current_chapter["paragraphs"]:
        chapters.append(current_chapter)
        
    return chapters

@app.get("/api/book/{book_id}")
def get_book(book_id: str):
    # Many gutenberg texts are at this pattern
    url = f"https://www.gutenberg.org/cache/epub/{book_id}/pg{book_id}.txt"
    resp = requests.get(url)
    
    # Sometimes it has a -0.txt or -8.txt suffix
    if resp.status_code != 200:
        url = f"https://www.gutenberg.org/files/{book_id}/{book_id}-0.txt"
        resp = requests.get(url)
        
    if resp.status_code != 200:
        url = f"https://www.gutenberg.org/files/{book_id}/{book_id}.txt"
        resp = requests.get(url)
        
    if resp.status_code != 200:
        raise HTTPException(status_code=404, detail="Book text format not found")
        
    # Attempt to decode properly
    resp.encoding = 'utf-8'
    text = resp.text
    
    chapters = parse_gutenberg_text(text)
    return {"id": book_id, "chapters": chapters}

@app.get("/api/proxy")
def proxy(url: str = Query(..., description="The URL to proxy")):
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'
        }
        resp = requests.get(url, headers=headers, timeout=25)
        content_type = resp.headers.get('content-type', 'application/octet-stream')
        return Response(
            content=resp.content,
            status_code=resp.status_code,
            headers={
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Content-Type': content_type
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Proxy error: {str(e)}")

