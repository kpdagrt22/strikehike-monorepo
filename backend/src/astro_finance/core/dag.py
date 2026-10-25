from typing import List, Callable, Dict, Any
from loguru import logger
import networkx as nx

class Task:
    def __init__(self, name: str, function: Callable, **kwargs):
        self.name = name
        self.function = function
        self.kwargs = kwargs

    def run(self, context: Dict[str, Any]):
        logger.info(f"Starting task: {self.name}")
        try:
            result = self.function(**self.kwargs)
            context[self.name] = result
            logger.info(f"Task {self.name} completed successfully.")
            return result
        except Exception as e:
            logger.error(f"Task {self.name} failed: {e}")
            raise e

class Pipeline:
    def __init__(self, name: str):
        self.name = name
        self.graph = nx.DiGraph()
        self.tasks = {}

    def add_task(self, task: Task, dependencies: List[str] = None):
        self.tasks[task.name] = task
        self.graph.add_node(task.name)
        
        if dependencies:
            for dep in dependencies:
                if dep not in self.tasks:
                    raise ValueError(f"Dependency {dep} not found for task {task.name}")
                self.graph.add_edge(dep, task.name)

    def run(self):
        logger.info(f"Running Pipeline: {self.name}")
        
        # Topological sort to determine execution order
        if not nx.is_directed_acyclic_graph(self.graph):
            raise ValueError("Pipeline has cyclical dependencies!")
            
        execution_order = list(nx.topological_sort(self.graph))
        context = {}
        
        for task_name in execution_order:
            task = self.tasks[task_name]
            task.run(context)
            
        logger.success(f"Pipeline {self.name} completed.")
