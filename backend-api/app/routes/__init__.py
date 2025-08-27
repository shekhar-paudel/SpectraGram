from .model_dashboard import model_dashboard_bp
from .worker import worker_bp


def register_routes(app):
    app.register_blueprint(model_dashboard_bp, url_prefix='/api/model')
    app.register_blueprint(worker_bp, url_prefix='/api/worker')

