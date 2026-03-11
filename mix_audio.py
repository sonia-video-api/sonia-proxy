import sys
import json
import base64
import os
import subprocess
import tempfile

def mix_audio(voice_base64, music_type, output_path):
    # Dictionnaire des musiques (URLs ou chemins locaux)
    # Pour cet exemple, nous utiliserons des fichiers de silence si la musique n'est pas trouvée
    # Dans un environnement réel, ces fichiers seraient présents sur le serveur
    music_files = {
        "epic": "assets/music/epic.mp3",
        "happy": "assets/music/happy.mp3",
        "mystery": "assets/music/mystery.mp3",
        "news": "assets/music/news.mp3",
        "lofi": "assets/music/lofi.mp3"
    }

    voice_data = base64.b64decode(voice_base64.split(',')[1] if ',' in voice_base64 else voice_base64)
    
    with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as v_file:
        v_file.write(voice_data)
        v_path = v_file.name

    try:
        music_path = music_files.get(music_type)
        if not music_path or not os.path.exists(music_path):
            # Si pas de musique, on retourne juste la voix
            return voice_base64

        # Utilisation de ffmpeg pour mixer
        # -i v_path : voix
        # -i music_path : musique
        # filter_complex : amix (mixage), volume (ajustement du niveau de la musique)
        cmd = [
            'ffmpeg', '-y',
            '-i', v_path,
            '-i', music_path,
            '-filter_complex', '[1:a]volume=0.15[music];[0:a][music]amix=inputs=2:duration=first[a]',
            '-map', '[a]',
            '-f', 'mp3',
            output_path
        ]
        
        subprocess.run(cmd, check=True, capture_output=True)
        
        with open(output_path, 'rb') as f:
            mixed_data = f.read()
            return 'data:audio/mp3;base64,' + base64.b64encode(mixed_data).decode('utf-8')

    except Exception as e:
        print(f"Error mixing: {e}", file=sys.stderr)
        return voice_base64
    finally:
        if os.path.exists(v_path):
            os.remove(v_path)

if __name__ == "__main__":
    try:
        input_data = json.load(sys.stdin)
        voice_b64 = input_data.get('voice')
        music_type = input_data.get('music', 'none')
        
        if music_type == 'none' or not voice_b64:
            print(json.dumps({"audio": voice_b64}))
        else:
            with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as out_file:
                out_path = out_file.name
            
            mixed_b64 = mix_audio(voice_b64, music_type, out_path)
            
            if os.path.exists(out_path):
                os.remove(out_path)
                
            print(json.dumps({"audio": mixed_b64}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
