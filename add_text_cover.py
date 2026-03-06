#!/usr/bin/env python3
"""
Script pour ajouter titre et sous-titre sur une couverture BD
Style: titre blanc gras avec contour noir en haut, sous-titre jaune en bas
Comme la couverture "La TikTokeuse Mystérieuse"
"""
import sys
import json
import base64
from io import BytesIO
from PIL import Image, ImageDraw, ImageFont
import urllib.request
import os

def download_font():
    """Télécharger une police bold si pas disponible"""
    font_paths = [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
        '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
        '/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf',
    ]
    for p in font_paths:
        if os.path.exists(p):
            return p
    return None

def wrap_text(text, font, draw, max_width):
    """Découper le texte en lignes selon la largeur max"""
    words = text.split()
    lines = []
    current_line = []
    
    for word in words:
        test_line = ' '.join(current_line + [word])
        bbox = draw.textbbox((0, 0), test_line, font=font)
        w = bbox[2] - bbox[0]
        if w <= max_width:
            current_line.append(word)
        else:
            if current_line:
                lines.append(' '.join(current_line))
            current_line = [word]
    
    if current_line:
        lines.append(' '.join(current_line))
    
    return lines

def draw_text_with_outline(draw, pos, text, font, fill, outline_color, outline_width=4):
    """Dessiner du texte avec contour"""
    x, y = pos
    # Dessiner le contour
    for dx in range(-outline_width, outline_width + 1):
        for dy in range(-outline_width, outline_width + 1):
            if dx != 0 or dy != 0:
                draw.text((x + dx, y + dy), text, font=font, fill=outline_color)
    # Dessiner le texte principal
    draw.text((x, y), text, font=font, fill=fill)

def add_text_to_cover(image_data_b64, titre, sous_titre=None):
    """
    Ajouter titre et sous-titre sur une couverture BD
    
    Args:
        image_data_b64: Image en base64
        titre: Titre de la BD (affiché en haut en blanc gras)
        sous_titre: Sous-titre (affiché en bas en jaune)
    
    Returns:
        Image modifiée en base64
    """
    # Décoder l'image
    img_bytes = base64.b64decode(image_data_b64)
    img = Image.open(BytesIO(img_bytes)).convert('RGBA')
    width, height = img.size
    
    # Créer un calque de dessin
    overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    
    # Charger la police
    font_path = download_font()
    
    # Taille de police adaptée à la largeur de l'image
    title_font_size = max(60, width // 8)
    subtitle_font_size = max(40, width // 12)
    
    if font_path:
        try:
            title_font = ImageFont.truetype(font_path, title_font_size)
            subtitle_font = ImageFont.truetype(font_path, subtitle_font_size)
        except:
            title_font = ImageFont.load_default()
            subtitle_font = ImageFont.load_default()
    else:
        title_font = ImageFont.load_default()
        subtitle_font = ImageFont.load_default()
    
    # === TITRE EN HAUT ===
    padding = width // 15
    max_text_width = width - (padding * 2)
    
    # Ajouter un dégradé sombre en haut pour le titre
    gradient_height = int(height * 0.35)
    for y in range(gradient_height):
        alpha = int(180 * (1 - y / gradient_height))
        draw.rectangle([(0, y), (width, y + 1)], fill=(0, 0, 0, alpha))
    
    # Découper le titre en lignes
    title_lines = wrap_text(titre, title_font, draw, max_text_width)
    
    # Calculer la hauteur totale du titre
    line_height = title_font_size + 10
    total_title_height = len(title_lines) * line_height
    
    # Dessiner chaque ligne du titre centrée
    y_title = padding
    for line in title_lines:
        bbox = draw.textbbox((0, 0), line, font=title_font)
        text_w = bbox[2] - bbox[0]
        x = (width - text_w) // 2
        draw_text_with_outline(draw, (x, y_title), line, title_font, 
                               fill=(255, 255, 255, 255), 
                               outline_color=(0, 0, 0, 255), 
                               outline_width=5)
        y_title += line_height
    
    # === SOUS-TITRE EN BAS ===
    if sous_titre:
        # Dégradé sombre en bas
        gradient_start = int(height * 0.75)
        for y in range(gradient_start, height):
            alpha = int(160 * ((y - gradient_start) / (height - gradient_start)))
            draw.rectangle([(0, y), (width, y + 1)], fill=(0, 0, 0, alpha))
        
        # Découper le sous-titre en lignes
        subtitle_lines = wrap_text(sous_titre, subtitle_font, draw, max_text_width)
        
        # Calculer la position du bas
        subtitle_line_height = subtitle_font_size + 8
        total_subtitle_height = len(subtitle_lines) * subtitle_line_height
        y_subtitle = height - total_subtitle_height - padding
        
        for line in subtitle_lines:
            bbox = draw.textbbox((0, 0), line, font=subtitle_font)
            text_w = bbox[2] - bbox[0]
            x = (width - text_w) // 2
            draw_text_with_outline(draw, (x, y_subtitle), line, subtitle_font,
                                   fill=(255, 220, 0, 255),  # Jaune
                                   outline_color=(0, 0, 0, 255),
                                   outline_width=4)
            y_subtitle += subtitle_line_height
    
    # Fusionner l'overlay avec l'image originale
    img_rgba = img.convert('RGBA')
    result = Image.alpha_composite(img_rgba, overlay)
    result = result.convert('RGB')
    
    # Encoder en base64
    output = BytesIO()
    result.save(output, format='JPEG', quality=95)
    output.seek(0)
    return base64.b64encode(output.read()).decode('utf-8')

if __name__ == '__main__':
    # Lire les arguments depuis stdin (JSON)
    data = json.loads(sys.stdin.read())
    image_b64 = data['image']
    titre = data['titre']
    sous_titre = data.get('sous_titre', '')
    
    result_b64 = add_text_to_cover(image_b64, titre, sous_titre)
    print(json.dumps({'image': result_b64}))
