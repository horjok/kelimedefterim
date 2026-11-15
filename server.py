"""
Kelime Defteri yerel sunucusu: giriş noktası.

Çalıştırma:
    pip install -r requirements.txt
    python server.py          # http://localhost:8000

Uygulamanın kendisi backend/ paketinde (backend/app.py), arayüz web/ klasöründe.
"""

from backend.app import app
from backend.config import HOST, PORT

if __name__ == "__main__":
    print(f"Kelime Defteri: http://localhost:{PORT}")
    app.run(host=HOST, port=PORT, debug=False)
