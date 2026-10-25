import sys
from loguru import logger

def configure_logger(level="DEBUG", log_file=None):
    """Configures the Loguru logger."""
    logger.remove()  # Remove default handler
    
    # Console handler
    logger.add(
        sys.stderr,
        format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
        level=level
    )
    
    # File handler
    if log_file:
        logger.add(
            log_file,
            rotation="10 MB",
            retention="10 days",
            compression="zip",
            level="DEBUG"
        )
    
    return logger
