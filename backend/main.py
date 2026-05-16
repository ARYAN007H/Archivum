from fastapi import FastAPI, HTTPException
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
    start_match = re.search(r'\*\*\* START OF THE PROJECT GUTENBERG EBOOK.*?\*\*\*', text)
    end_match = re.search(r'\*\*\* END OF THE PROJECT GUTENBERG EBOOK.*?\*\*\*', text)
    
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
        # A heading is usually short and often uppercase or starts with Chapter
        is_heading = False
        lines = block.split('\n')
        if len(lines) <= 2 and len(block) < 100:
            if block.isupper() or block.lower().startswith('chapter') or block.lower().startswith('book') or block.lower().startswith('part'):
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
